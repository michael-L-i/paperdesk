import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../server/workspace.js';
let root, ws;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-test-')); ws = new Workspace(root, path.join(root, 'app')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
test('create, save, recover and reject stale concurrent writes', async () => {
  const original = await ws.create('Course/Practice_1');
  const results = await Promise.allSettled([ws.save(original.path, 'first', original.revision), ws.save(original.path, 'second', original.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await ws.read(original.path)).text, 'first');
  const history = path.join(root, 'Course/Practice_1/.paperdesk/history');
  const snapshot = JSON.parse(await fs.readFile(path.join(history, (await fs.readdir(history))[0])));
  assert.equal(snapshot.text, original.text);
  await assert.rejects(ws.create('Course/Practice_1'), /already has/);
});
test('root traversal and symlink escapes are rejected', async () => {
  await assert.rejects(ws.resolve('../outside', false), { status: 403 });
  await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
  await assert.rejects(ws.resolve('escape/new', false), { status: 403 });
  await assert.rejects(ws.create('escape/paperdesk-should-not-exist'), { status: 403 });
});
test('import keeps original bytes and rolls back when destination conflicts', async () => {
  const source = Buffer.from('%PDF-test');
  await fs.writeFile(path.join(root, 'original.pdf'), source);
  await ws.create('Practice', 'original.pdf');
  assert.deepEqual(await fs.readFile(path.join(root, 'Practice/source.pdf')), source);
  assert.deepEqual(await fs.readFile(path.join(root, 'original.pdf')), source);
  await fs.mkdir(path.join(root, 'Conflict'));
  await fs.writeFile(path.join(root, 'Conflict/source.pdf'), 'keep');
  await assert.rejects(ws.create('Conflict', 'original.pdf'));
  assert.equal(await fs.readFile(path.join(root, 'Conflict/source.pdf'), 'utf8'), 'keep');
  await assert.rejects(fs.stat(path.join(root, 'Conflict/main.tex')), { code: 'ENOENT' });
});
