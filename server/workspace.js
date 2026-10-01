import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { run } from './process.js';

export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const template = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,graphicx}
\setlength{\parindent}{0pt}

\begin{document}
\null
\end{document}
`;
// Files the editor can open; everything else in a project is listed but read-only.
export const textFile = name => /\.(tex|bib|sty|cls|bst|txt|md)$/i.test(name);
// latexmk builds in a temp folder, but linked folders may hold other tools' output.
const buildOutput = /\.(aux|log|fls|fdb_latexmk|synctex\.gz|out|toc|bbl|blg|bcf|run\.xml)$/i;
const visible = relative => typeof relative === 'string' && !relative.split('/').some(part => !part || part.startsWith('.'));
const exists = file => fs.stat(file).then(() => true, () => false);
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
        else if (!buildOutput.test(entry.name)) files.push(path.relative(this.root, full));
      }
    };
    await visit(this.root);
    return files.sort();
  }
  exclusive(key, fn) { return withLock(path.join(this.root, key), fn); }
  // A path for a new file: visible, inside the project, with its folders created.
  async prepare(relative) {
    if (!visible(relative)) throw httpError('Enter a valid filename.');
    const file = await this.resolve(relative, false);
    await fs.mkdir(path.dirname(file), { recursive: true });
    return file;
  }
  async rename(from, to) {
    const source = await this.resolve(from);
    if (source === this.root) throw httpError('Choose a file.');
    if (await exists(await this.resolve(to, false))) throw httpError(`${to} already exists.`, 409);
    await fs.rename(source, await this.prepare(to));
    return to;
  }
  // Deleted files go to the macOS Trash, so a mistake can be undone.
  async trash(relative) {
    const file = await this.resolve(relative);
    if (file === this.root) throw httpError('Choose a file.');
    await run('/usr/bin/trash', [file]);
  }
  async read(relative) {
    if (!textFile(relative)) throw httpError('Choose a text file.');
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
  // Applies the agent's complete-file edits. Every edit is checked against the revisions
  // seen when the request started before any file is written.
  async apply(edits, revisions) {
    if (!Array.isArray(edits) || edits.length > 50) throw httpError('The agent returned too many edits. No changes applied.');
    const paths = new Set();
    for (const { path: file, content } of edits) {
      if (!visible(file) || !textFile(file) || typeof content !== 'string' || content.length > 1_000_000 || paths.has(file)) throw httpError(`The agent returned an invalid edit for ${file}. No changes applied.`);
      paths.add(file);
      const target = await this.resolve(file, false);
      if (Object.hasOwn(revisions, file)) {
        if ((await this.read(file)).revision !== revisions[file]) throw httpError(`${file} changed while the agent was working. No changes applied.`, 409);
      } else if (await exists(target)) throw httpError(`${file} already exists. No changes applied.`, 409);
      // A new .tex must not compile over an existing PDF, such as the original assignment.
      else if (file.endsWith('.tex') && await exists(target.replace(/\.tex$/, '.pdf'))) throw httpError(`${file} would overwrite an existing PDF. Ask the agent to use another filename.`);
    }
    const applied = [];
    for (const { path: file, content } of edits) {
      if (Object.hasOwn(revisions, file)) { const { previous, ...saved } = await this.save(file, content, revisions[file], 'ai'); applied.push(saved); continue; }
      await fs.writeFile(await this.prepare(file), content, { flag: 'wx' }).catch(e => { if (e.code === 'EEXIST') throw httpError(`${file} was created while the agent was working.`, 409); throw e; });
      applied.push(await this.read(file));
    }
    return applied;
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
