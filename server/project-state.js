import fs from 'node:fs/promises';
import { hash, textFile } from './workspace.js';

// A file's hash is reused until its size or modification time changes, so frequent checks stay cheap.
const hashes = new Map();
async function fileHash(file) {
  const { size, mtimeMs } = await fs.stat(file), key = `${size}:${mtimeMs}`, cached = hashes.get(file);
  if (cached?.key === key) return cached.hash;
  const value = hash(await fs.readFile(file));
  hashes.set(file, { key, hash: value });
  return value;
}

// Content hashes ignore timestamps and build outputs, so publishing a PDF never
// triggers another build. Images and assignment PDFs are build inputs too.
export async function sourceState(workspace) {
  const files = await workspace.list(), inputs = {};
  for (const name of files) {
    if (!textFile(name) && !/\.(png|jpe?g|gif|webp|svg|pdf|eps)$/i.test(name)) continue;
    if (/\.pdf$/i.test(name) && files.includes(name.replace(/\.pdf$/i, '.tex'))) continue;
    inputs[name] = await fileHash(await workspace.resolve(name));
  }
  return { files, fingerprint: hash(JSON.stringify(inputs)) };
}

export async function projectState(workspace, primary, open) {
  const state = await sourceState(workspace);
  const doc = open ? await workspace.read(open) : null;
  let preview = null;
  if (primary) {
    await workspace.resolve(primary);
    try {
      const map = JSON.parse(await fs.readFile(workspace.syncFile(primary), 'utf8'));
      const pdf = primary.replace(/\.tex$/, '.pdf');
      const pdfHash = await fileHash(await workspace.resolve(pdf));
      preview = { path: pdf, revision: map.revision, version: pdfHash, engine: map.engine,
        current: map.fingerprint === state.fingerprint && map.pdfHash === pdfHash };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { ...state, doc, preview };
}
