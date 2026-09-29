import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { httpError } from './workspace.js';

const images = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const documents = new Set(['.docx', '.doc', '.rtf', '.odt']);
// How the agent reads an attachment: PDF pages, image input, macOS textutil, or plain text.
export function attachmentKind(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return bytes.subarray(0, 1024).includes('%PDF-') ? 'pdf' : null;
  if (images.has(ext)) return 'image';
  if (documents.has(ext)) return process.platform === 'darwin' ? 'document' : null;
  if (bytes.includes(0)) return null;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'text'; } catch { return null; }
}
export class Uploads {
  constructor(dir) { this.dir = dir; this.items = new Map(); }
  async init() { await fs.rm(this.dir, { recursive: true, force: true }); await fs.mkdir(this.dir, { recursive: true }); return this; }
  async add(name, bytes) {
    name = path.basename(String(name)).replace(/[\0-\x1f]/g, '').slice(-200);
    if (!name || name === '.' || name === '..') throw httpError('Invalid filename.');
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw httpError('The file is empty.');
    const kind = attachmentKind(name, bytes);
    if (!kind) throw httpError(`${name} can't be read. Attach a PDF, image, document, or text file.`, 415);
    for (const [id, old] of this.items) if (Date.now() - old.created > 86400000) await this.remove(id);
    const id = crypto.randomUUID();
    const file = path.join(this.dir, id + path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, ''));
    await fs.writeFile(file, bytes);
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
    await fs.rm(item.file, { force: true });
  }
}
