import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Uploads } from '../server/uploads.js';
test('keep uploads under their real names and remove them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-uploads-'));
  try {
    const uploads = await new Uploads(path.join(dir, 'uploads')).init();
    const added = await uploads.add('../../escape.tex', Buffer.from('\\section{A}'));
    assert.deepEqual({ name: added.name, kind: added.kind }, { name: 'escape.tex', kind: 'file' });
    const { file } = uploads.get(added.id);
    assert.equal(path.basename(file), 'escape.tex');
    assert.equal(path.dirname(path.dirname(file)), path.join(dir, 'uploads'));
    assert.equal((await uploads.add('Board.PNG', Buffer.from([0x89, 0x50]))).kind, 'image');
    assert.equal((await uploads.add('archive.zip', Buffer.from([0x50, 0x4b, 3, 4, 0]))).kind, 'file');
    await assert.rejects(uploads.add('empty.txt', Buffer.alloc(0)), /empty/);
    await uploads.remove(added.id);
    await assert.rejects(fs.stat(path.dirname(file)), { code: 'ENOENT' });
    assert.throws(() => uploads.get(added.id), e => e.status === 410);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
