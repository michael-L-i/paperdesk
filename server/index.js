import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Workspace, atomicWrite, httpError } from './workspace.js';
import { run } from './process.js';
import { askAI } from './ai.js';
import { gunzipSync } from 'node:zlib';
import { parseSourceMap, inverseSearch } from './synctex.js';
import { hash } from './workspace.js';
import { Uploads } from './uploads.js';
import { compileLatex } from './latex.js';
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.WORKSPACE_ROOT || path.join(appDir, '..'));
const workspace = new Workspace(root, appDir);
const dataDir = path.resolve(process.env.PAPERDESK_DATA_DIR || path.join(appDir, '.data'));
await fs.mkdir(dataDir, { recursive: true });
const uploads = await new Uploads(path.join(dataDir, 'uploads')).init();
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
  await workspace.exclusive('style-examples', async () => {
    const examples = await readJSON('examples.json', []);
    examples.push({ file, date: new Date().toISOString(), before: before.slice(start,endBefore).slice(0,2000), after: after.slice(start,endAfter).slice(0,2000) });
    await writeJSON('examples.json', examples.slice(-40));
  });
}
app.get('/api/workspace', async (req, res) => res.json({ root, files: await workspace.list() }));

app.get('/api/directory', async (req, res) => {
  const relative = req.query.path || '';
  const dir = await workspace.resolve(relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  res.json({ root, path: path.relative(root, dir), entries: entries
    .filter(e => !e.name.startsWith('.') && !e.isSymbolicLink() && !['node_modules','dist'].includes(e.name) && path.join(dir,e.name) !== appDir)
    .filter(e => e.isDirectory() || /\.(tex|pdf)$/i.test(e.name))
    .map(e => ({ name: e.name, directory: e.isDirectory(), path: path.relative(root,path.join(dir,e.name)) }))
    .sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name)) });
});
let choosingDirectory = false;
app.post('/api/choose-directory', async (req, res) => {
  if (process.platform !== 'darwin') throw httpError('The native folder picker requires macOS.');
  if (choosingDirectory) throw httpError('The folder picker is already open.', 409);
  const initial = await workspace.resolve(req.body.path || '');
  choosingDirectory = true;
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', path.join(appDir, 'server/choose-directory.js'), initial], { timeout: 600000 });
    const selected = JSON.parse(stdout);
    if (selected.cancelled) return res.json({ cancelled: true });
    const directory = await workspace.resolve(selected.path);
    res.json({ path: path.relative(root, directory) });
  } finally { choosingDirectory = false; }
});
app.post('/api/new-document', async (req, res) => {
  const { directory = '', name = 'main.tex' } = req.body;
  if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.tex')) throw httpError('Enter a .tex filename.');
  const dir = await workspace.resolve(directory);
  const file = path.join(dir, name);
  const { template } = await import('./workspace.js');
  await fs.writeFile(file, template, { flag:'wx' }).catch(e => { if(e.code==='EEXIST') throw httpError('That file already exists.',409); throw e; });
  res.json(await workspace.read(path.relative(root,file)));
});
app.post('/api/uploads', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => res.json(await uploads.add(req.query.name || '', req.body)));
app.delete('/api/uploads/:id', async (req, res) => { await uploads.remove(req.params.id); res.json({ ok: true }); });
app.post('/api/task', async (req,res) => {
  if (aiBusy) throw httpError('The agent is already working.',409);
  const { directory = '', instruction, path: primary, revision, attachments: ids = [] } = req.body;
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) throw httpError('Enter a request.');
  if (!Array.isArray(ids) || ids.length > 10) throw httpError('Attach up to 10 files.');
  const attachments = ids.map(id => uploads.get(id));
  const dir = await workspace.resolve(directory);
  const entries = await fs.readdir(dir, {withFileTypes:true});
  const names = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
  const documents = {};
  for (const name of names.filter(n => n.endsWith('.tex'))) {
    const relative = path.relative(root,path.join(dir,name));
    const stat = await fs.stat(path.join(dir,name));
    if (stat.size > 1_000_000) continue;
    documents[relative] = await workspace.read(relative);
  }
  const doc = primary ? documents[primary] : null;
  if (primary && (!doc || doc.revision !== revision)) throw httpError('The primary file changed. Reload it before asking the agent.',409);
  if (!attachments.length) {
    const mentioned = names.filter(n => n.toLowerCase().endsWith('.pdf') && instruction.toLowerCase().includes(n.toLowerCase()));
    const pdfs = names.filter(n => n.toLowerCase().endsWith('.pdf'));
    const candidate = mentioned[0] || (/\b(convert|transcribe|import)\b/i.test(instruction) && pdfs.length === 1 ? pdfs[0] : null);
    if (candidate) attachments.push({ name: candidate, kind: 'pdf', file: await workspace.resolve(path.relative(root,path.join(dir,candidate))) });
    else if (/\b(convert|transcribe|import)\b.*\bpdf\b/i.test(instruction) && pdfs.length !== 1) throw httpError('Select the PDF to convert.');
  }
  const style = await readStyle(), examples = await readJSON('examples.json', []);
  const id = crypto.randomUUID();
  const job = { id, status:'running', directory, primary, documents, attachments, started:Date.now() };
  for(const [key,old] of jobs) if(old.status!=='running' && Date.now()-old.started>3600000) jobs.delete(key);
  jobs.set(id,job); aiBusy=true;
  res.json({id});
  const context = JSON.stringify({ directory, files:names, primary:doc ? path.basename(doc.path) : null, attachments:attachments.map(a => a.name),
    documents:Object.values(documents).slice(0,15).map(d => ({filename:path.basename(d.path),text:d.text.slice(0,12000)})) });
  askAI({instruction, text:doc?.text || '',style,examples:examples.slice(-8),attachments,mode:'task',context})
    .then(result => { job.result=result; job.status='done'; })
    .catch(e => { job.error=e.message; job.status='error'; })
    .finally(() => { aiBusy=false; for (const upload of ids) uploads.remove(upload).catch(() => {}); });
});
app.post('/api/tasks/:id/apply', async (req,res) => {
  const job=jobs.get(req.params.id);
  if (!job || job.status !== 'done') throw httpError('The agent result is not ready.',409);
  if (job.applied) return res.json(job.applied);
  if (!job.result.latex) return res.json({message:job.result.message});
  const pdf=job.attachments.find(a => a.kind === 'pdf');
  const name=job.result.filename || (pdf ? path.basename(pdf.name,path.extname(pdf.name))+'_solutions.tex' : job.primary ? path.basename(job.primary) : 'main.tex');
  if (path.basename(name)!==name || !name.endsWith('.tex')) throw httpError('The agent returned an invalid filename.');
  const dir=await workspace.resolve(job.directory);
  const file=path.join(dir,name), relative=path.relative(root,file);
  const output=file.replace(/\.tex$/,'.pdf');
  if (job.attachments.some(a => a.name.toLowerCase() === path.basename(output).toLowerCase()) && await fs.stat(output).then(() => true, () => false)) throw httpError('This filename would overwrite the original PDF. Ask the agent to use another filename.');
  const prior=job.documents[relative];
  if(prior) job.applied=await workspace.save(relative,job.result.latex,prior.revision,'ai');
  else {
    await workspace.resolve(relative,false);
    await fs.writeFile(file,job.result.latex,{flag:'wx'}).catch(e=>{if(e.code==='EEXIST')throw httpError('That file was created while the agent was working. No changes applied.',409);throw e;});
    job.applied=await workspace.read(relative);
  }
  delete job.applied.previous;
  res.json(job.applied);
});
app.get('/api/document', async (req, res) => res.json(await workspace.read(req.query.path)));
app.post('/api/project', async (req, res) => res.json(await workspace.create(req.body.folder, req.body.source)));
app.put('/api/document', async (req, res) => {
  const { path: file, text, revision, origin } = req.body;
  if (typeof text !== 'string' || typeof revision !== 'string' || text.length > 1_000_000) throw httpError('Invalid document.');
  const saved = await workspace.save(file, text, revision, ['ai','restore'].includes(origin) ? origin : 'human');
  if (!['ai','restore'].includes(origin) && saved.previous !== undefined) await captureEdit(saved.previous, text, file);
  delete saved.previous; res.json(saved);
});
app.get('/api/pdf', async (req, res) => {
  if (!String(req.query.path).toLowerCase().endsWith('.pdf')) throw httpError('Choose a PDF.');
  const file = await workspace.resolve(req.query.path);
  res.type('pdf').sendFile(file);
});
app.post('/api/compile', async (req, res) => {
  const relative = req.body.path;
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
app.post('/api/inverse-search', async (req,res) => {
  const { path: primary, revision, page, x, y } = req.body;
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
    return {path:match.path,line:match.line};
  });
  res.json(result);
});
app.get('/api/history', async (req, res) => {
  const file = await workspace.resolve(req.query.path);
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
app.delete('/api/style/examples', async (req, res) => { await workspace.exclusive('style-examples', () => writeJSON('examples.json', [])); res.json({ ok: true }); });
app.post('/api/ai', async (req, res) => {
  if (aiBusy) throw httpError('An AI request is already running.', 409);
  const { path: file, instruction, selection, mode, revision } = req.body;
  if (!['edit', 'question', 'import', 'style'].includes(mode) || typeof instruction !== 'string' || instruction.length > 20000 || (selection && typeof selection !== 'string')) throw httpError('Invalid AI request.');
  const doc = await workspace.read(file);
  if (doc.revision !== revision) throw httpError('Save before asking the agent.', 409);
  let source;
  if (mode === 'import') {
    source = await workspace.resolve(path.join(path.dirname(file), 'source.pdf'));
  }
  const style = await readStyle();
  const examples = await readJSON('examples.json', []);
  if (mode === 'style' && !examples.length) throw httpError('Write or revise some answers first. Human edits become examples after saving.');
  const id = crypto.randomUUID();
  const job = { id, status: 'running', file, revision, mode, started: Date.now() };
  for (const [key, old] of jobs) if (old.status !== 'running' && Date.now() - old.started > 3600000) jobs.delete(key);
  jobs.set(id, job); aiBusy = true;
  res.json({ id });
  askAI({ instruction, selection, mode, text: doc.text, style, examples: mode === 'style' ? examples : examples.slice(-8), source })
    .then(result => Object.assign(job, { status: 'done', result }))
    .catch(e => Object.assign(job, { status: 'error', error: e.message }))
    .finally(() => { aiBusy = false; });
});
app.get('/api/jobs/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) throw httpError('Request no longer exists. Please retry.', 404); const {documents,attachments,...visible}=job; res.json(visible); });
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(appDir, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(appDir, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: appDir, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((e, req, res, next) => { console.error(e.message); res.status(e.status || (e.code === 'ENOENT' ? 404 : 500)).json({ error: e.message }); });
app.listen(port, '127.0.0.1', () => console.log(`Paperdesk: http://localhost:${port}\nWorkspace: ${root}`));
