import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { atomicWrite, hash, httpError } from './workspace.js';
import { compileLatex, parseLog } from './latex.js';
import { parseSourceMap, inverseSearch, refineLine } from './synctex.js';
import { sourceState } from './project-state.js';

// Compiles a main document and publishes its PDF and source map together, or neither.
export async function buildPdf(workspace, relative, revision) {
  const { root } = workspace;
  if (!String(relative).endsWith('.tex')) throw httpError('Choose a .tex file.');
  return workspace.exclusive(relative, async () => {
    const doc = await workspace.read(relative);
    if (doc.revision !== revision) throw httpError('Save your latest changes before compiling.', 409);
    const file = await workspace.resolve(relative);
    const { fingerprint } = await sourceState(workspace);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-build-'));
    // TeX records real paths, which differ from the workspace path under a symlink.
    const realRoot = await fs.realpath(root), realDir = await fs.realpath(path.dirname(file));
    const sourceName = input => path.relative(realRoot, path.resolve(realDir, input));
    // Log entries point at workspace files when they can; package files keep only their name.
    const located = entries => entries.map(e => {
      const name = e.file && sourceName(e.file);
      return name && !name.startsWith('..') && !path.isAbsolute(name) ? { ...e, file:name } : { ...e, file:null, origin:e.file && path.basename(e.file) };
    });
    try {
      let engine;
      try { engine = await compileLatex(file, doc.text, temp); }
      catch (e) { if (e.diagnostics) e.diagnostics = located(e.diagnostics); throw e; }
      const diagnostics = located(parseLog(await fs.readFile(path.join(temp, path.basename(file, '.tex') + '.log'), 'utf8').catch(() => '')));
      const output = file.replace(/\.tex$/, '.pdf');
      await workspace.resolve(path.relative(root, output), false);
      const compiled = await fs.readFile(path.join(temp, path.basename(output)));
      const rawSync = gunzipSync(await fs.readFile(path.join(temp,path.basename(file,'.tex')+'.synctex.gz'))).toString('utf8');
      const sourceMap = parseSourceMap(rawSync);
      const inputs = {};
      for (const input of sourceMap.files) {
        try {
          const name = sourceName(input), resolved = await workspace.resolve(name);
          if (resolved.endsWith('.tex')) inputs[name] = hash(await fs.readFile(resolved));
        } catch { /* Package inputs outside the workspace are not editable. */ }
      }
      if ((await sourceState(workspace)).fingerprint !== fingerprint || (await workspace.read(relative)).revision !== doc.revision) throw httpError('Source changed during compilation. Compile again.',409);
      sourceMap.records = sourceMap.records.map(r=>({...r,path:sourceName(r.path)})).filter(r=>inputs[r.path]);
      const metadata = { fingerprint, engine, revision:doc.revision, pdfHash:hash(compiled), inputs, records:sourceMap.records };
      await fs.mkdir(path.dirname(workspace.syncFile(relative)),{recursive:true});
      await atomicWrite(output, compiled);
      await atomicWrite(workspace.syncFile(relative),JSON.stringify(metadata));
      return { pdf: path.relative(root, output), revision: doc.revision, engine, fingerprint, version: metadata.pdfHash, diagnostics };
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });
}
// Finds the source line behind a point in the compiled PDF, refusing when either has changed since the build.
export async function locateSource(workspace, { path: primary, revision, version, page, x, y, word, before, after }) {
  if (!Number.isInteger(page) || page<1 || !Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0) throw httpError('Invalid PDF location.');
  return workspace.exclusive(primary,async()=>{
    const doc=await workspace.read(primary);
    let map;
    try { map=JSON.parse(await fs.readFile(workspace.syncFile(primary),'utf8')); }
    catch(e) { if(e.code==='ENOENT')throw httpError('Compile once to enable PDF-to-source navigation.',409);throw e; }
    if((version && version!==map.pdfHash) || map.revision!==revision || doc.revision!==map.revision)throw httpError('The preview is out of date. Compile again before jumping to source.',409);
    if(map.fingerprint && (await sourceState(workspace)).fingerprint!==map.fingerprint)throw httpError('A source file changed. Compile again before jumping to source.',409);
    const output=await workspace.resolve(primary.replace(/\.tex$/,'.pdf'));
    if(hash(await fs.readFile(output))!==map.pdfHash)throw httpError('The PDF changed. Compile again before jumping to source.',409);
    for(const [input,expected] of Object.entries(map.inputs)) {
      const inputFile=await workspace.resolve(input);
      if(hash(await fs.readFile(inputFile))!==expected)throw httpError('A source file changed. Compile again before jumping to source.',409);
    }
    const match=inverseSearch(map.records,page,x,y);
    if(!match)throw httpError('No source location on this page.',404);
    await workspace.resolve(match.path);
    if(typeof word!=='string' || !word.trim() || word.length>200)return {path:match.path,line:match.line};
    const source=(await workspace.read(match.path)).text;
    return {path:match.path,line:refineLine(map.records,match,source,{word,before:String(before??'').slice(-200),after:String(after??'').slice(0,200)})};
  });
}
