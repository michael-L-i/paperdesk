import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askAI, describeCommand } from '../server/ai.js';
test('summarize agent commands as a status line', () => {
  assert.equal(describeCommand(`/bin/zsh -lc "pdftotext -layout '/Users/me/Fall 26:27/EE160A/hw1.pdf' -"`), 'Reading hw1.pdf');
  assert.equal(describeCommand('/bin/zsh -lc "latexmk -pdf main.tex"'), 'Compiling main.tex');
  assert.equal(describeCommand('/bin/zsh -lc "ls -la"'), 'Looking through files');
});
test('give the agent the folder, file roles, attachments, and conversation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-test-'));
  const fake = path.join(dir, 'fake-codex.mjs');
  // Records the prompt and arguments, streams one command event, then answers.
  await fs.writeFile(fake, `#!${process.execPath}
import fs from 'node:fs/promises';
let input = ''; for await (const chunk of process.stdin) input += chunk;
await fs.writeFile(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), prompt: input }));
process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'pdftotext -layout hw1.pdf -' } }) + '\\n');
await fs.writeFile(process.argv[process.argv.indexOf('-o') + 1], JSON.stringify({ message: 'Done.', latex: '', style: '', filename: '' }));
`);
  await fs.chmod(fake, 0o755);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = fake;
  try {
    const activity = [];
    const result = await askAI({ instruction: 'Which parts need code?', mode: 'task', text: '\\section*{Problem 1}', workspace: '/w', folder: '/w/EE160A', primary: 'hw.tex',
      files: ['- hw.tex (1 KB, open in the editor)', '- hw.pdf (40 KB, compiled from hw.tex)', '- hw1.pdf (300 KB)'],
      attachments: [{ name: 'board.png', kind: 'image', file: '/u/board.png' }, { name: 'notes.txt', kind: 'file', file: '/u/notes.txt' }],
      history: [{ role: 'You', text: 'What is due?' }, { role: 'Agent', text: 'Problems 1-3.' }], onActivity: a => activity.push(a) });
    assert.equal(result.message, 'Done.');
    assert.deepEqual(activity, ['Reading hw1.pdf']);
    const { args, prompt } = JSON.parse(await fs.readFile(path.join(dir, 'call.json'), 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'workspace-write']);
    assert.deepEqual(args.filter((a, i) => args[i - 1] === '-i'), ['/u/board.png'], 'Only images are image input');
    for (const expected of ["The user's folder is /w/EE160A, inside their workspace /w.", '- hw.pdf (40 KB, compiled from hw.tex)', '- notes.txt: /u/notes.txt',
      'Current LaTeX (hw.tex, open in the editor):\n\\section*{Problem 1}', 'Conversation so far:\nYou: What is due?\n\nAgent: Problems 1-3.', 'User request:\nWhich parts need code?'])
      assert.ok(prompt.includes(expected), `Prompt is missing: ${expected}`);
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
