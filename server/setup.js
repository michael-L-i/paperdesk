import { agents, onPath } from './agents.js';

// What Paperdesk needs on this machine, and how to get whatever is missing.
export async function checkSetup() {
  const mac = process.platform === 'darwin';
  const tools = [
    { name: 'LaTeX', command: 'latexmk', purpose: 'Compiles your documents', fix: mac ? 'brew install --cask mactex-no-gui' : 'Install TeX Live with latexmk' },
    { name: 'Poppler', command: 'pdftotext', purpose: 'Lets the agent read PDFs', fix: mac ? 'brew install poppler' : 'Install poppler-utils' },
  ];
  return {
    tools: await Promise.all(tools.map(async ({ command, ...tool }) => ({ ...tool, ok: await onPath(command) }))),
    agents: await Promise.all(Object.entries(agents).map(async ([id, agent]) => ({ id, name: agent.name, fix: agent.install, ok: await onPath(agent.bin()) }))),
  };
}
