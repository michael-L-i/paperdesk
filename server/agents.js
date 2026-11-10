import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './process.js';

// A short status line for a shell command the agent runs, e.g. "Reading hw1.pdf".
export function describeCommand(command) {
  const file = command.match(/([^\s/'"\\]+\.(?:pdf|tex|bib|sty|cls|txt|md|csv|json|py|ipynb|m|c|cpp|h|js|png|jpe?g))(?![\w.])/i)?.[1];
  if (/\b(?:latexmk|pdflatex|xelatex|lualatex)\b/.test(command)) return 'Compiling' + (file ? ' ' + file : '');
  return file ? 'Reading ' + file : 'Looking through files';
}
// An agent is a CLI that takes the prompt on stdin and answers with JSON matching the schema.
// It may read the whole project but write only in `temp`, its scratch working directory.
// `read` turns one line of its JSON output into { activity }, { result } or { error }.
export const agents = {
  codex: {
    name: 'Codex', bin: () => process.env.CODEX_BIN || 'codex', install: 'npm install -g @openai/codex',
    args: ({ temp, images, model }) => ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'workspace-write', '--color', 'never',
      '--output-schema', path.join(temp, 'schema.json'), '-o', path.join(temp, 'result.json'), '-C', temp, ...(model ? ['-m', model] : []), ...images.flatMap(file => ['-i', file]), '-'],
    read: event => event.type === 'item.started' && event.item?.type === 'command_execution' ? { activity: describeCommand(event.item.command) } : null,
  },
  claude: {
    name: 'Claude Code', bin: () => process.env.CLAUDE_BIN || 'claude', install: 'npm install -g @anthropic-ai/claude-code',
    // No file-editing tools, and shell commands run in Claude Code's sandbox, which allows writes only in the working directory.
    args: ({ schema, folder, model }) => ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config',
      '--tools', 'Read,Glob,Grep,Bash', '--allowedTools', 'Read Glob Grep Bash', '--permission-prompts', 'none', '--json-schema', JSON.stringify(schema), ...(model ? ['--model', model] : []),
      '--settings', JSON.stringify({ sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: folder ? [folder] : [] } } })],
    read(event) {
      if (event.type === 'result') return event.is_error ? { error: String(event.result) } : { result: event.structured_output };
      const use = event.type === 'assistant' && event.message?.content?.find(part => part.type === 'tool_use');
      if (!use || use.name === 'StructuredOutput') return null;
      return { activity: use.name === 'Bash' ? describeCommand(use.input.command) : use.name === 'Read' ? 'Reading ' + path.basename(use.input.file_path) : 'Looking through files' };
    },
  },
};
// Whether a command exists, without running it.
export async function onPath(bin) {
  const dirs = bin.includes('/') ? [''] : (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) if (await fs.access(path.join(dir, bin), fs.constants.X_OK).then(() => true, () => false)) return true;
  return false;
}
export async function runAgent(id, { temp, prompt, schema, folder, images = [], model, onActivity, signal }) {
  const agent = agents[id];
  if (!agent) throw new Error('No agent is set up. Choose one in Settings.');
  await fs.writeFile(path.join(temp, 'schema.json'), JSON.stringify(schema));
  let pending = '', result, error;
  const read = line => {
    try { const out = agent.read(JSON.parse(line)); if (out?.activity) onActivity?.(out.activity); result = out?.result ?? result; error = out?.error ?? error; } catch { /* Not a JSON event. */ }
  };
  const onOutput = chunk => { const lines = (pending + chunk).split('\n'); pending = lines.pop(); lines.forEach(read); };
  try { await run(agent.bin(), agent.args({ temp, schema, folder, images, model }), { cwd: temp, input: prompt, timeout: 0, onOutput, signal }); }
  catch (e) { throw error && !signal?.aborted ? new Error(error) : e; }
  read(pending);
  if (error) throw new Error(error);
  return result ?? JSON.parse(await fs.readFile(path.join(temp, 'result.json'), 'utf8').catch(() => 'null'));
}
