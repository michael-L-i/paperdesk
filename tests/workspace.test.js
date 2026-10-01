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
test('list every project file except build output, and open only text files', async () => {
  await fs.mkdir(path.join(root, 'chapters'));
  for (const name of ['main.tex', 'main.aux', 'main.pdf', 'refs.bib', 'chapters/intro.tex', 'figure.png', '.hidden.tex']) await fs.writeFile(path.join(root, name), 'x');
  assert.deepEqual(await ws.list(), ['chapters/intro.tex', 'figure.png', 'main.pdf', 'main.tex', 'refs.bib']);
  assert.equal((await ws.read('refs.bib')).text, 'x');
  await assert.rejects(ws.read('figure.png'), { status: 400 });
});
test('new file paths must be visible and inside the project', async () => {
  assert.equal(await ws.prepare('figures/plot.png'), path.join(root, 'figures/plot.png'));
  assert.ok((await fs.stat(path.join(root, 'figures'))).isDirectory());
  for (const bad of ['.paperdesk/history/x.json', 'a//b.tex', '../escape.tex', 'figures/', undefined]) await assert.rejects(ws.prepare(bad), { status: 400 });
});
test('apply agent edits to several files, or to none on any conflict', async () => {
  await fs.mkdir(path.join(root, 'chapters'));
  await fs.writeFile(path.join(root, 'main.tex'), 'main');
  await fs.writeFile(path.join(root, 'chapters/intro.tex'), 'intro');
  await fs.writeFile(path.join(root, 'exam.pdf'), '%PDF');
  const revisions = { 'main.tex': (await ws.read('main.tex')).revision, 'chapters/intro.tex': (await ws.read('chapters/intro.tex')).revision };
  // Changed on disk while the agent worked: nothing is written, not even the valid edits.
  await fs.writeFile(path.join(root, 'chapters/intro.tex'), 'intro, edited by hand');
  await assert.rejects(ws.apply([{ path: 'refs.bib', content: '@misc{a}' }, { path: 'chapters/intro.tex', content: 'new' }], revisions), { status: 409 });
  await assert.rejects(fs.stat(path.join(root, 'refs.bib')), { code: 'ENOENT' });
  await assert.rejects(ws.apply([{ path: 'exam.tex', content: 'x' }], revisions), /overwrite an existing PDF/);
  await assert.rejects(ws.apply([{ path: 'main.pdf', content: 'x' }], revisions), { status: 400 });
  await assert.rejects(ws.apply([{ path: '../escape.tex', content: 'x' }], revisions), { status: 400 });
  await assert.rejects(ws.apply([{ path: 'exam.pdf', content: 'x' }], revisions), { status: 400 });
  const applied = await ws.apply([{ path: 'main.tex', content: 'main v2' }, { path: 'figures/notes.txt', content: 'notes' }], revisions);
  assert.deepEqual(applied.map(d => [d.path, d.text]), [['main.tex', 'main v2'], ['figures/notes.txt', 'notes']]);
  assert.equal(applied[0].previous, undefined);
  const history = await fs.readdir(path.join(root, '.paperdesk/history'));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.paperdesk/history', history[0]))).origin, 'ai');
});
test('rename a file into a new folder without overwriting', async () => {
  await fs.writeFile(path.join(root, 'plot.png'), 'png');
  await fs.writeFile(path.join(root, 'taken.png'), 'keep');
  assert.equal(await ws.rename('plot.png', 'figures/plot.png'), 'figures/plot.png');
  assert.equal(await fs.readFile(path.join(root, 'figures/plot.png'), 'utf8'), 'png');
  await assert.rejects(ws.rename('figures/plot.png', 'taken.png'), { status: 409 });
  await assert.rejects(ws.rename('figures/plot.png', '../escape.png'), { status: 403 });
  assert.equal(await fs.readFile(path.join(root, 'taken.png'), 'utf8'), 'keep');
});
test('add new files, numbering taken names only when asked', async () => {
  const pixel = Buffer.from('png');
  const names = await Promise.all([ws.add('image.png', pixel, true), ws.add('image.png', pixel, true)]);
  assert.deepEqual(names.sort(), ['image-2.png', 'image.png']);
  assert.equal(await ws.add('notes', pixel, true), 'notes');
  assert.equal(await ws.add('notes', pixel, true), 'notes-2');
  await assert.rejects(ws.add('image.png', pixel), { status: 409 });
  await assert.rejects(ws.add('.hidden.png', pixel, true), { status: 400 });
});
