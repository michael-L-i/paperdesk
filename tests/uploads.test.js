import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Uploads, attachmentKind } from '../server/uploads.js';
test('classify attachments by how the agent can read them', () => {
  assert.equal(attachmentKind('exam.pdf', Buffer.from('%PDF-1.7\n...')), 'pdf');
  assert.equal(attachmentKind('fake.pdf', Buffer.from('not a pdf')), null);
  assert.equal(attachmentKind('Board.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0])), 'image');
  assert.equal(attachmentKind('notes.md', Buffer.from('# Notes — ∫ f(x) dx')), 'text');
  assert.equal(attachmentKind('data', Buffer.from('a,b\n1,2')), 'text');
  assert.equal(attachmentKind('archive.zip', Buffer.from([0x50, 0x4b, 3, 4, 0, 0])), null);
  assert.equal(attachmentKind('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])), null);
});
test('store uploads under generated names and remove them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-uploads-'));
  try {
    const uploads = await new Uploads(path.join(dir, 'uploads')).init();
    const added = await uploads.add('../../escape.tex', Buffer.from('\\section{A}'));
    assert.deepEqual({ name: added.name, kind: added.kind }, { name: 'escape.tex', kind: 'text' });
    const { file } = uploads.get(added.id);
    assert.equal(path.dirname(file), path.join(dir, 'uploads'));
    await assert.rejects(uploads.add('blob.bin', Buffer.from([1, 0, 2])), e => e.status === 415);
    await assert.rejects(uploads.add('empty.txt', Buffer.alloc(0)), /empty/);
    await uploads.remove(added.id);
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    assert.throws(() => uploads.get(added.id), e => e.status === 410);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
