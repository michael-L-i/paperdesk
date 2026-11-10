import fs from 'node:fs/promises';
import path from 'node:path';
import { hash, textFile } from './workspace.js';

// Content hashes ignore timestamps and build outputs, so publishing a PDF never
// triggers another build. Images and assignment PDFs are build inputs too.
export async function sourceState(workspace) {
  const files = await workspace.list(), inputs = {};
  for (const name of files) {
    if (!textFile(name) && !/\.(png|jpe?g|gif|webp|svg|pdf|eps)$/i.test(name)) continue;
    if (/\.pdf$/i.test(name) && files.includes(name.replace(/\.pdf$/i, '.tex'))) continue;
    inputs[name] = hash(await fs.readFile(await workspace.resolve(name)));
  }
  return { files, fingerprint: hash(JSON.stringify(inputs)) };
}

export async function projectState(workspace, primary, open) {
  const state = await sourceState(workspace);
  const doc = open ? await workspace.read(open) : null;
  let preview = null;
  if (primary) {
    const file = await workspace.resolve(primary);
    const mapFile = path.relative(workspace.root, path.join(path.dirname(file), '.paperdesk', 'sync', path.basename(file) + '.json'));
    try {
      const map = JSON.parse(await fs.readFile(await workspace.resolve(mapFile), 'utf8'));
      const pdf = primary.replace(/\.tex$/, '.pdf');
      const pdfHash = hash(await fs.readFile(await workspace.resolve(pdf)));
      preview = { path: pdf, revision: map.revision, version: pdfHash, engine: map.engine,
        current: map.fingerprint === state.fingerprint && map.pdfHash === pdfHash };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { ...state, doc, preview };
}
