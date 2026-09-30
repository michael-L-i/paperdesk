import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const template = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,graphicx}
\setlength{\parindent}{0pt}

\begin{document}
\null
\end{document}
`;
export function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export async function atomicWrite(file, content) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, content); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }); }
}
const locks = new Map();
// Serializes work per key, such as an absolute file path, across every Workspace.
export async function withLock(key, fn) {
  const prior = locks.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(fn);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
export class Workspace {
  constructor(root, appDir) { this.root = path.resolve(root); this.appDir = appDir; }
  async resolve(relative = '', existing = true) {
    if (typeof relative !== 'string' || relative.includes('\0')) throw httpError('Invalid path.');
    const target = path.resolve(this.root, relative);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) throw httpError('Paths outside the project are not allowed.', 403);
    let probe = target;
    while (true) {
      try {
        const real = await fs.realpath(probe);
        const realRoot = await fs.realpath(this.root);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw httpError('Paths outside the project are not allowed.', 403);
        break;
      } catch (e) {
        if (e.code !== 'ENOENT' || existing || probe === this.root) throw e;
        probe = path.dirname(probe);
      }
    }
    return target;
  }
  async list() {
    const files = [];
    const visit = async (dir, depth = 0) => {
      if (depth > 10 || files.length > 3000) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (full === this.appDir || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(full, depth + 1);
        else if (/\.(tex|pdf)$/i.test(entry.name)) files.push(path.relative(this.root, full));
      }
    };
    await visit(this.root);
    return files.sort();
  }
  exclusive(key, fn) { return withLock(path.join(this.root, key), fn); }
  async read(relative) {
    if (!relative.endsWith('.tex')) throw httpError('Choose a .tex file.');
    const file = await this.resolve(relative);
    const text = await fs.readFile(file, 'utf8');
    return { path: relative, text, revision: hash(text) };
  }
  async save(relative, text, revision, origin = 'human') {
    return this.exclusive(relative, async () => {
      const current = await this.read(relative);
      if (current.revision !== revision) throw httpError('This file changed on disk. Your draft is preserved. Reopen the file to load the disk version.', 409);
      if (current.text === text) return current;
      const file = await this.resolve(relative);
      const meta = path.join(path.dirname(file), '.paperdesk');
      await this.resolve(path.relative(this.root, path.join(meta, 'history')), false);
      await fs.mkdir(path.join(meta, 'history'), { recursive: true });
      const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      await fs.writeFile(path.join(meta, 'history', `${id}.json`), JSON.stringify({ path: relative, text: current.text, origin, date: new Date().toISOString() }));
      await atomicWrite(file, text);
      const entries = (await fs.readdir(path.join(meta, 'history'))).sort();
      for (const old of entries.slice(0, Math.max(0, entries.length - 80))) await fs.unlink(path.join(meta, 'history', old));
      return { path: relative, text, revision: hash(text), previous: current.text };
    });
  }
  async create(folder, source) {
    if (!folder || folder === '.') throw httpError('Give this paper its own folder.');
    const dir = await this.resolve(folder, false);
    const file = path.join(dir, 'main.tex');
    if (source) {
      if (!source.toLowerCase().endsWith('.pdf')) throw httpError('Choose a PDF source.');
      await this.resolve(source);
    }
    await fs.mkdir(dir, { recursive: true });
    // Validate again after creation, including existing symlink components.
    await this.resolve(path.relative(this.root, dir));
    await fs.writeFile(file, template, { flag: 'wx' }).catch(e => { if (e.code === 'EEXIST') throw httpError('That folder already has main.tex. Open it instead.'); throw e; });
    try {
      if (source) {
        const src = await this.resolve(source);
        if (src !== path.join(dir, 'source.pdf')) await fs.copyFile(src, path.join(dir, 'source.pdf'), 1);
      }
    } catch (e) { await fs.unlink(file); throw e; }
    return this.read(path.relative(this.root, file));
  }
}
