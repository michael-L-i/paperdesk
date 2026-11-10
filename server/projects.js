import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite, httpError, template, withLock } from './workspace.js';
import { run } from './process.js';

const isDirectory = dir => fs.stat(dir).then(s => s.isDirectory(), () => false);
// A project is a folder: a linked one the user picked, or a library one Paperdesk created.
export class Projects {
  constructor(file, library) { this.file = file; this.library = path.resolve(library); }
  async all() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  update(fn) {
    return withLock(this.file, async () => {
      const list = await this.all(), result = await fn(list);
      await atomicWrite(this.file, JSON.stringify(list, null, 2));
      return result;
    });
  }
  add(list, fields) {
    const project = { id: crypto.randomBytes(6).toString('base64url'), ...fields, opened: new Date().toISOString() };
    list.push(project);
    return project;
  }
  async list() {
    const list = (await this.all()).sort((a, b) => b.opened.localeCompare(a.opened));
    return Promise.all(list.map(async p => ({ ...p, missing: !await isDirectory(p.path) })));
  }
  async get(id) {
    const project = (await this.all()).find(p => p.id === id);
    if (!project) throw httpError('Project not found.', 404);
    return project;
  }
  async link(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || !await isDirectory(dir)) throw httpError('Choose a folder.');
    dir = path.resolve(dir);
    return this.update(list => list.find(p => p.path === dir) || this.add(list, { name: path.basename(dir), kind: 'linked', path: dir }));
  }
  // Points a project at its folder's new location. Other missing projects that moved with
  // the same parent, such as a renamed course folder, follow it.
  async relocate(id, dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || !await isDirectory(dir)) throw httpError('Choose a folder.');
    dir = path.resolve(dir);
    return this.update(async list => {
      const project = list.find(p => p.id === id);
      if (!project) throw httpError('Project not found.', 404);
      if (list.some(p => p !== project && p.path === dir)) throw httpError('That folder is already a project.', 409);
      const from = project.path.split(path.sep), to = dir.split(path.sep);
      while (from.length > 1 && to.length > 1 && from.at(-1) === to.at(-1)) { from.pop(); to.pop(); }
      const oldParent = from.join(path.sep) + path.sep, newParent = to.join(path.sep) + path.sep;
      project.path = dir;
      for (const other of list) {
        if (!other.path.startsWith(oldParent) || await isDirectory(other.path)) continue;
        const moved = newParent + other.path.slice(oldParent.length);
        if (await isDirectory(moved) && !list.some(p => p.path === moved)) other.path = moved;
      }
      return project;
    });
  }
  async create(name) {
    name = String(name ?? '').trim().replace(/[/\\:\0-\x1f]/g, '-').slice(0, 100);
    if (!name || name.startsWith('.')) throw httpError('Enter a project name.');
    await fs.mkdir(this.library, { recursive: true });
    let dir;
    for (let n = 1; ; n++) {
      dir = path.join(this.library, n === 1 ? name : `${name} ${n}`);
      try { await fs.mkdir(dir); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    await fs.writeFile(path.join(dir, 'main.tex'), template);
    return this.update(list => this.add(list, { name, kind: 'library', path: dir, mainFile: 'main.tex' }));
  }
  // Marks the project as opened now, optionally recording its main document.
  open(id, fields = {}) {
    return this.update(list => {
      const project = list.find(p => p.id === id);
      if (!project) throw httpError('Project not found.', 404);
      return Object.assign(project, fields, { opened: new Date().toISOString() });
    });
  }
  // Linked folders are only forgotten; library folders go to the Trash.
  async remove(id) {
    const project = await this.get(id);
    if (project.kind === 'library' && project.path.startsWith(this.library + path.sep) && await isDirectory(project.path)) await run('/usr/bin/trash', [project.path]);
    await this.update(list => { const i = list.findIndex(p => p.id === id); if (i >= 0) list.splice(i, 1); });
  }
}
