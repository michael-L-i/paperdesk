import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Workspace, atomicWrite, httpError, template, textFile, withLock } from './workspace.js';
import { run } from './process.js';
import { askAI } from './ai.js';
import { gunzipSync } from 'node:zlib';
import { parseSourceMap, inverseSearch, refineLine } from './synctex.js';
import { hash } from './workspace.js';
import { compileLatex } from './latex.js';
import { Projects } from './projects.js';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.PAPERDESK_DATA_DIR || path.join(appDir, '.data'));
await fs.mkdir(dataDir, { recursive: true });
const library = path.resolve(process.env.PAPERDESK_LIBRARY || path.join(os.homedir(), 'Documents', 'Paperdesk'));
const projects = new Projects(path.join(dataDir, 'projects.json'), library);
const app = express();
const port = Number(process.env.PORT || 4317);
const jobs = new Map();
let aiBusy = false;
// Bind to loopback; reject cross-origin writes and DNS rebinding.
app.use((req, res, next) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: 'Local access only.' });
  if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin access denied.' });
  res.set('Cache-Control', 'no-store'); next();
});
app.use(express.json({ limit: '2mb' }));
const readJSON = async (name, fallback) => { try { return JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const writeJSON = (name, value) => atomicWrite(path.join(dataDir, name), JSON.stringify(value, null, 2));
const stylePath = path.join(dataDir, 'writing-style.md');
const readStyle = async () => { try { return await fs.readFile(stylePath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
async function captureEdit(before, after, file) {
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < Math.min(endBefore, endAfter) && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const addition = after.slice(start, endAfter).trim();
  if (addition.length < 20) return;
  await withLock('style-examples', async () => {
    const examples = await readJSON('examples.json', []);
    examples.push({ file, date: new Date().toISOString(), before: before.slice(start,endBefore).slice(0,2000), after: after.slice(start,endAfter).slice(0,2000) });
    await writeJSON('examples.json', examples.slice(-40));
  });
}
app.get('/api/projects', async (req, res) => res.json(await projects.list()));
// Links an existing folder ({ path }) or creates a library project ({ name }).
app.post('/api/projects', async (req, res) => res.json(req.body.path ? await projects.link(req.body.path) : await projects.create(req.body.name)));
let choosingDirectory = false;
app.post('/api/choose-directory', async (req, res) => {
  if (process.platform !== 'darwin') throw httpError('The native folder picker requires macOS.');
  if (choosingDirectory) throw httpError('The folder picker is already open.', 409);
  choosingDirectory = true;
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', path.join(appDir, 'server/choose-directory.js')], { timeout: 600000 });
    res.json(JSON.parse(stdout));
  } finally { choosingDirectory = false; }
});
// Every file route is scoped to one project folder.
const project = express.Router({ mergeParams: true });
app.use('/api/projects/:project', project);
project.use(async (req, res, next) => {
  req.project = await projects.get(req.params.project);
  req.ws = new Workspace(req.project.path, appDir);
  next();
});
project.patch('/', async (req, res) => {
  const { mainFile } = req.body;
  if (mainFile !== undefined && (typeof mainFile !== 'string' || !mainFile.endsWith('.tex'))) throw httpError('Choose a .tex file.');
  if (mainFile) await req.ws.resolve(mainFile);
  res.json(await projects.open(req.project.id, mainFile ? { mainFile } : {}));
});
project.delete('/', async (req, res) => { await projects.remove(req.project.id); res.json({ ok: true }); });
project.post('/reveal', async (req, res) => { await run('/usr/bin/open', ['-R', req.project.path]); res.json({ ok: true }); });
project.get('/files', async (req, res) => {
  if (!await fs.stat(req.ws.root).then(s => s.isDirectory(), () => false)) throw httpError("This project's folder was moved or deleted. Remove it from your projects and open it again.", 404);
  res.json(await req.ws.list());
});
project.post('/new-document', async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !textFile(name)) throw httpError('Use a text file type such as .tex or .bib.');
  const file = await req.ws.prepare(name);
  // Top-level .tex files start as documents; files in subfolders are usually \input fragments.
  await fs.writeFile(file, name.endsWith('.tex') && !name.includes('/') ? template : '', { flag:'wx' }).catch(e => { if(e.code==='EEXIST') throw httpError('That file already exists.',409); throw e; });
  res.json(await req.ws.read(path.relative(req.ws.root, file)));
});
project.post('/upload', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError('The file is empty.');
  res.json({ path: await req.ws.add(req.query.path, req.body, req.query.unique === '1') });
});
// One agent request at a time; the client polls /api/jobs/:id for the result and can stop it.
function startJob(fields, ask) {
  if (aiBusy) throw httpError('The agent is already working.', 409);
  for (const [key, old] of jobs) if (old.status !== 'running' && Date.now() - old.started > 3600000) jobs.delete(key);
  const job = { id: crypto.randomUUID(), status: 'running', started: Date.now(), controller: new AbortController(), ...fields };
  jobs.set(job.id, job); aiBusy = true;
  ask(job).then(result => Object.assign(job, { status: 'done', result }), e => Object.assign(job, job.controller.signal.aborted ? { status: 'stopped' } : { status: 'error', error: e.message })).finally(() => { aiBusy = false; });
  return job.id;
}
const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
project.post('/task', async (req,res) => {
  const { instruction, path: open, main, revision, attachments: names = [], history = [] } = req.body;
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) throw httpError('Enter a request.');
  if (!Array.isArray(names) || names.length > 10) throw httpError('Attach up to 10 files.');
  if (!Array.isArray(history) || history.some(m => !['You', 'Agent'].includes(m?.role) || typeof m.text !== 'string')) throw httpError('Invalid conversation.');
  // Attachments were copied into the project when they were added; images also go to Codex as image input.
  const attachments = await Promise.all(names.map(async name => ({ name, kind: /\.(png|jpe?g|gif|webp)$/i.test(name) ? 'image' : 'file',
    file: await req.ws.resolve(name).catch(e => { throw e.status ? e : httpError(`${name} is no longer in the project. Attach it again.`, 404); }) })));
  // Describe the project so the agent knows, e.g., that hw.pdf is built from hw.tex.
  // Text file revisions let the agent's edits be checked for conflicts when they are applied.
  const all = await req.ws.list(), revisions = {}, files = [];
  let doc = null;
  for (const file of all) {
    const { size: bytes } = await fs.stat(path.join(req.ws.root, file));
    if (textFile(file) && bytes <= 1_000_000) { const current = await req.ws.read(file); revisions[file] = current.revision; if (file === open) doc = current; }
    const source = file.replace(/\.pdf$/i, '.tex');
    const roles = [file === main && 'main document', file === open && 'open in the editor', source !== file && all.includes(source) && `compiled from ${source}`].filter(Boolean);
    files.push(`- ${file} (${[size(bytes), ...roles].join(', ')})`);
  }
  if (files.length > 500) files.splice(500, Infinity, `- … and ${files.length - 500} more`);
  if (open && (!doc || doc.revision !== revision)) throw httpError('The open file changed. Reload it before asking the agent.',409);
  const style = await readStyle(), examples = await readJSON('examples.json', []);
  res.json({ id: startJob({ root: req.ws.root, revisions }, job => askAI({
    instruction, mode: 'task', text: doc?.text, style, examples: examples.slice(-8), folder: req.ws.root, files, open: doc?.path, main: typeof main === 'string' ? main : '', attachments,
    history: history.slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 4000) })), onActivity: activity => { job.activity = activity; }, signal: job.controller.signal,
  })) });
});
app.post('/api/tasks/:id/apply', async (req,res) => {
  const job=jobs.get(req.params.id);
  if (!job || job.status !== 'done') throw httpError('The agent result is not ready.',409);
  job.applied ??= new Workspace(job.root,appDir).apply(job.result.edits,job.revisions);
  res.json(await job.applied);
});
project.get('/document', async (req, res) => res.json(await req.ws.read(req.query.path)));
project.put('/document', async (req, res) => {
  const { path: file, text, revision, origin } = req.body;
  if (typeof text !== 'string' || typeof revision !== 'string' || text.length > 1_000_000) throw httpError('Invalid document.');
  const saved = await req.ws.save(file, text, revision, ['ai','restore'].includes(origin) ? origin : 'human');
  if (!['ai','restore'].includes(origin) && saved.previous !== undefined && file.endsWith('.tex')) await captureEdit(saved.previous, text, file);
  delete saved.previous; res.json(saved);
});
// Serves any project file; the sandbox keeps a file opened in its own tab, such as an SVG, from running scripts.
project.get('/file', async (req, res) => {
  res.set({ 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' }).sendFile(await req.ws.resolve(req.query.path));
});
project.post('/rename', async (req, res) => res.json({ path: await req.ws.rename(req.body.from, req.body.to) }));
project.delete('/file', async (req, res) => { await req.ws.trash(req.query.path); res.json({ ok: true }); });
project.post('/compile', async (req, res) => {
  const workspace = req.ws, { root } = workspace, relative = req.body.path;
  if (!String(relative).endsWith('.tex')) throw httpError('Choose a .tex file.');
  const result = await workspace.exclusive(relative, async () => {
    const doc = await workspace.read(relative);
    if (doc.revision !== req.body.revision) throw httpError('Save your latest changes before compiling.', 409);
    const file = await workspace.resolve(relative);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-build-'));
    try {
      const engine = await compileLatex(file, doc.text, temp);
      const output = file.replace(/\.tex$/, '.pdf');
      await workspace.resolve(path.relative(root, output), false);
      const compiled = await fs.readFile(path.join(temp, path.basename(output)));
      const rawSync = gunzipSync(await fs.readFile(path.join(temp,path.basename(file,'.tex')+'.synctex.gz'))).toString('utf8');
      const sourceMap = parseSourceMap(rawSync);
      // TeX records real paths, which differ from the workspace path under a symlink.
      const realRoot = await fs.realpath(root), realDir = await fs.realpath(path.dirname(file));
      const sourceName = input => path.relative(realRoot, path.resolve(realDir, input));
      const inputs = {};
      for (const input of sourceMap.files) {
        try {
          const name = sourceName(input), resolved = await workspace.resolve(name);
          if (resolved.endsWith('.tex')) inputs[name] = hash(await fs.readFile(resolved));
        } catch { /* Package inputs outside the workspace are not editable. */ }
      }
      if ((await workspace.read(relative)).revision !== doc.revision) throw httpError('Source changed during compilation. Compile again.',409);
      sourceMap.records = sourceMap.records.map(r=>({...r,path:sourceName(r.path)})).filter(r=>inputs[r.path]);
      const metadata = { revision:doc.revision, pdfHash:hash(compiled), inputs, records:sourceMap.records };
      const mapDir = await workspace.resolve(path.relative(root,path.join(path.dirname(file),'.paperdesk','sync')),false);
      await fs.mkdir(mapDir,{recursive:true});
      await atomicWrite(output, compiled);
      await atomicWrite(path.join(mapDir,path.basename(file)+'.json'),JSON.stringify(metadata));
      return { pdf: path.relative(root, output), revision: doc.revision, engine };
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }); res.json(result);
});
project.post('/inverse-search', async (req,res) => {
  const workspace = req.ws, { root } = workspace, { path: primary, revision, page, x, y } = req.body;
  if (!Number.isInteger(page) || page<1 || !Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0) throw httpError('Invalid PDF location.');
  const result = await workspace.exclusive(primary,async()=>{
    const doc=await workspace.read(primary);
    const file=await workspace.resolve(primary);
    const mapFile=await workspace.resolve(path.relative(root,path.join(path.dirname(file),'.paperdesk','sync',path.basename(file)+'.json')),false);
    let map;
    try { map=JSON.parse(await fs.readFile(mapFile,'utf8')); }
    catch(e) { if(e.code==='ENOENT')throw httpError('Compile once to enable PDF-to-source navigation.',409);throw e; }
    if(map.revision!==revision || doc.revision!==map.revision)throw httpError('The preview is out of date. Compile again before jumping to source.',409);
    const output=await workspace.resolve(primary.replace(/\.tex$/,'.pdf'));
    if(hash(await fs.readFile(output))!==map.pdfHash)throw httpError('The PDF changed. Compile again before jumping to source.',409);
    for(const [input,expected] of Object.entries(map.inputs)) {
      const inputFile=await workspace.resolve(input);
      if(hash(await fs.readFile(inputFile))!==expected)throw httpError('A source file changed. Compile again before jumping to source.',409);
    }
    const match=inverseSearch(map.records,page,x,y);
    if(!match)throw httpError('No source location on this page.',404);
    await workspace.resolve(match.path);
    const { word, before, after } = req.body;
    if(typeof word!=='string' || !word.trim() || word.length>200)return {path:match.path,line:match.line};
    const source=(await workspace.read(match.path)).text;
    return {path:match.path,line:refineLine(map.records,match,source,{word,before:String(before??'').slice(-200),after:String(after??'').slice(0,200)})};
  });
  res.json(result);
});
project.get('/history', async (req, res) => {
  const workspace = req.ws, { root } = workspace, file = await workspace.resolve(req.query.path);
  const history = path.join(path.dirname(file), '.paperdesk', 'history');
  await workspace.resolve(path.relative(root, history), false);
  let names = []; try { names = await fs.readdir(history); } catch(e) { if (e.code !== 'ENOENT') throw e; }
  const versions = await Promise.all(names.filter(n => n.endsWith('.json')).sort().reverse().map(async n => ({ id: n, ...JSON.parse(await fs.readFile(path.join(history, n), 'utf8')) })));
  res.json(versions.filter(v => v.path === req.query.path));
});
app.get('/api/style', async (req, res) => res.json({ text: await readStyle(), examples: (await readJSON('examples.json', [])).length }));
app.put('/api/style', async (req, res) => {
  if (typeof req.body.text !== 'string' || req.body.text.length > 20000) throw httpError('Invalid style profile.');
  await atomicWrite(stylePath, req.body.text); res.json({ ok: true });
});
app.delete('/api/style/examples', async (req, res) => { await withLock('style-examples', () => writeJSON('examples.json', [])); res.json({ ok: true }); });
project.post('/style/suggest', async (req, res) => {
  const { path: file, instruction, revision } = req.body;
  if (typeof instruction !== 'string' || instruction.length > 20000) throw httpError('Invalid request.');
  const doc = await req.ws.read(file);
  if (doc.revision !== revision) throw httpError('Save before asking the agent.', 409);
  const style = await readStyle(), examples = await readJSON('examples.json', []);
  if (!examples.length) throw httpError('Write or revise some answers first. Human edits become examples after saving.');
  res.json({ id: startJob({ file, revision }, job => askAI({ instruction, mode: 'style', text: doc.text, style, examples, signal: job.controller.signal })) });
});
app.get('/api/jobs/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) throw httpError('Request no longer exists. Please retry.', 404); const {revisions,applied,controller,...visible}=job; res.json(visible); });
app.post('/api/jobs/:id/stop', (req, res) => { const job = jobs.get(req.params.id); if (!job) throw httpError('Request no longer exists.', 404); job.controller.abort(); res.json({ ok: true }); });
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(appDir, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(appDir, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  // Vite refuses every file path containing ':', which would block an app folder like "Fall 26:27".
  // Requests reach Vite only after the loopback and origin checks above.
  const vite = await createServer({ root: appDir, server: { middlewareMode: true, fs: { strict: !appDir.includes(':') } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((e, req, res, next) => { console.error(e.message); res.status(e.status || (e.code === 'ENOENT' ? 404 : 500)).json({ error: e.message }); });
app.listen(port, '127.0.0.1', () => console.log(`Paperdesk: http://localhost:${port}\nLibrary: ${library}`));
