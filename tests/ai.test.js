import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askAI } from '../server/ai.js';
import { agents, describeCommand, onPath } from '../server/agents.js';
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
await fs.writeFile(process.argv[process.argv.indexOf('-o') + 1], JSON.stringify({ message: 'Done.', style: '', edits: [] }));
`);
  await fs.chmod(fake, 0o755);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = fake;
  try {
    const activity = [];
    const result = await askAI({ instruction: 'Which parts need code?', mode: 'task', text: '\\section*{Problem 1}', folder: '/w/EE160A', open: 'parts/q1.tex', main: 'hw.tex',
      files: ['- hw.tex (1 KB, main document)', '- hw.pdf (40 KB, compiled from hw.tex)', '- hw1.pdf (300 KB)', '- parts/q1.tex (1 KB, open in the editor)'],
      attachments: [{ name: 'board.png', kind: 'image', file: '/u/board.png' }, { name: 'notes.txt', kind: 'file', file: '/u/notes.txt' }],
      history: [{ role: 'You', text: 'What is due?' }, { role: 'Agent', text: 'Problems 1-3.' }], onActivity: a => activity.push(a) });
    assert.equal(result.message, 'Done.');
    assert.deepEqual(activity, ['Reading hw1.pdf']);
    const { args, prompt } = JSON.parse(await fs.readFile(path.join(dir, 'call.json'), 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'workspace-write']);
    assert.deepEqual(args.filter((a, i) => args[i - 1] === '-i'), ['/u/board.png'], 'Only images are image input');
    for (const expected of ["The user's project folder is /w/EE160A.", '- hw.pdf (40 KB, compiled from hw.tex)', '- notes.txt: /u/notes.txt',
      'Main document (the file that compiles to the PDF): hw.tex', 'Open in the editor (parts/q1.tex):\n\\section*{Problem 1}', 'Conversation so far:\nYou: What is due?\n\nAgent: Problems 1-3.', 'User request:\nWhich parts need code?'])
      assert.ok(prompt.includes(expected), `Prompt is missing: ${expected}`);
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('stop a running agent request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-stop-'));
  const fake = path.join(dir, 'fake-codex.mjs');
  await fs.writeFile(fake, `#!${process.execPath}\nfor await (const chunk of process.stdin);\nprocess.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } }) + '\\n');\nawait new Promise(r => setTimeout(r, 60000));\n`);
  await fs.chmod(fake, 0o755);
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = fake;
  try {
    const controller = new AbortController(), started = Date.now();
    const request = askAI({ instruction: 'Take your time.', mode: 'task', onActivity: () => controller.abort(), signal: controller.signal });
    await assert.rejects(request, /was stopped/);
    assert.ok(Date.now() - started < 10000);
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('run Claude Code read-only and take its structured result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-ai-claude-'));
  const fake = path.join(dir, 'fake-claude.mjs'), event = value => `console.log(${JSON.stringify(JSON.stringify(value))});`;
  const use = (name, input) => event({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  await fs.writeFile(fake, `#!${process.execPath}
import fs from 'node:fs/promises';
let input = ''; for await (const chunk of process.stdin) input += chunk;
await fs.writeFile(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify(process.argv.slice(2)));
if (input.includes('Sign out')) { ${event({ type: 'result', is_error: true, result: 'Not logged in. Run claude to sign in.' })} process.exit(1); }
${use('Read', { file_path: '/w/p/notes.txt' })}
${use('Bash', { command: 'latexmk -pdf main.tex' })}
${use('StructuredOutput', {})}
process.stdout.write(${JSON.stringify(JSON.stringify({ type: 'result', is_error: false, structured_output: { message: 'Done.', style: '', edits: [] } }))});
`);
  await fs.chmod(fake, 0o755);
  process.env.CLAUDE_BIN = fake;
  try {
    assert.equal(await onPath(agents.claude.bin()), true);
    assert.equal(await onPath('paperdesk-no-such-command'), false);
    const activity = [];
    const result = await askAI({ agent: 'claude', model: 'sonnet', instruction: 'Check it.', mode: 'task', folder: '/w/p', onActivity: a => activity.push(a) });
    assert.equal(result.message, 'Done.');
    assert.deepEqual(activity, ['Reading notes.txt', 'Compiling main.tex']);
    const args = JSON.parse(await fs.readFile(path.join(dir, 'call.json'), 'utf8')), value = flag => args[args.indexOf(flag) + 1];
    assert.equal(value('--tools'), 'Read,Glob,Grep,Bash', 'No file-editing tools');
    assert.equal(value('--model'), 'sonnet');
    assert.deepEqual(JSON.parse(value('--settings')).sandbox, { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: ['/w/p'] } });
    assert.deepEqual(Object.keys(JSON.parse(value('--json-schema')).properties), ['message', 'style', 'edits']);
    await assert.rejects(askAI({ agent: 'claude', instruction: 'Sign out', mode: 'task' }), /Not logged in/);
    await assert.rejects(askAI({ agent: 'other', instruction: 'Hi', mode: 'task' }), /No agent is set up/);
  } finally {
    delete process.env.CLAUDE_BIN;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
