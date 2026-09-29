import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { httpError } from './workspace.js';

// Images go to the agent as image input; it reads every other file itself.
const images = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
export class Uploads {
  constructor(dir) { this.dir = dir; this.items = new Map(); }
  async init() { await fs.rm(this.dir, { recursive: true, force: true }); await fs.mkdir(this.dir, { recursive: true }); return this; }
  async add(name, bytes) {
    name = path.basename(String(name)).replace(/[\0-\x1f]/g, '').slice(-200);
    if (!name || name === '.' || name === '..') throw httpError('Invalid filename.');
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw httpError('The file is empty.');
    for (const [id, old] of this.items) if (Date.now() - old.created > 86400000) await this.remove(id);
    // Each upload keeps its real name inside its own folder.
    const id = crypto.randomUUID(), file = path.join(this.dir, id, name);
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, bytes);
    const kind = images.has(path.extname(name).toLowerCase()) ? 'image' : 'file';
    this.items.set(id, { id, name, kind, file, created: Date.now() });
    return { id, name, kind };
  }
  get(id) {
    const item = this.items.get(id);
    if (!item) throw httpError('An attachment expired. Attach it again.', 410);
    return item;
  }
  async remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    await fs.rm(path.dirname(item.file), { recursive: true, force: true });
  }
}
