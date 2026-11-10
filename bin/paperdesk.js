#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appDir, dataDir, port } from '../server/config.js';
import { run } from '../server/process.js';

const url = `http://localhost:${port}`;
const label = 'com.paperdesk.server', domain = `gui/${process.getuid?.()}`;
const plist = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist');
const running = () => fetch(`http://127.0.0.1:${port}/api/projects`).then(r => r.ok, () => false);
const exists = file => fs.stat(file).then(() => true, () => false);
const open = () => process.argv.includes('--no-open') || run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]).catch(() => {});
const launchctl = (...args) => run('/bin/launchctl', args);
const loaded = () => launchctl('print', `${domain}/${label}`).then(() => true, () => false);

// A source checkout builds its UI when the source is newer; the npm package ships it built.
async function build() {
  const built = await fs.stat(path.join(appDir, 'dist/index.html')).then(s => s.mtimeMs, () => 0);
  if (!await exists(path.join(appDir, 'src'))) return false;
  const sources = ['index.html', 'package.json', ...(await fs.readdir(path.join(appDir, 'src'))).map(f => 'src/' + f)];
  const changed = await Promise.all(sources.map(f => fs.stat(path.join(appDir, f)).then(s => s.mtimeMs > built)));
  if (!changed.includes(true)) return false;
  console.log('Building Paperdesk…');
  if (!await exists(path.join(appDir, 'node_modules/vite'))) await run('npm', ['install', '--include=dev'], { cwd: appDir, timeout: 0 });
  await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: appDir });
  return true;
}
const xml = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// The service inherits this shell's PATH and settings, so it finds the same TeX and agent commands.
function servicePlist() {
  const keep = ['PATH', 'PORT', 'PAPERDESK_DATA_DIR', 'PAPERDESK_LIBRARY', 'CODEX_BIN', 'CLAUDE_BIN'];
  const env = { ...Object.fromEntries(keep.filter(k => process.env[k]).map(k => [k, process.env[k]])), NODE_ENV: 'production' };
  const strings = list => list.map(s => `<string>${xml(s)}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${strings([process.execPath, path.join(appDir, 'server/index.js')])}</array>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(dataDir, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(dataDir, 'server.log'))}</string>
</dict></plist>
`;
}
const commands = {
  // Runs in this terminal until you press Ctrl+C.
  async start() {
    if (await running()) return open();
    await build();
    process.env.NODE_ENV ??= 'production';
    await import('../server/index.js');
    await open();
  },
  // Runs in the background: starts at login and restarts if it ever stops.
  async install() {
    if (process.platform !== 'darwin') throw new Error('The background service needs macOS. Run `paperdesk` instead.');
    const rebuilt = await build(), content = servicePlist(), service = await loaded();
    const current = service && await fs.readFile(plist, 'utf8').catch(() => '') === content;
    if (!current || rebuilt || !await running()) {
      if (!service && await running()) throw new Error(`Paperdesk is already running in a terminal. Stop it there (Ctrl+C), then run this again.`);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(path.dirname(plist), { recursive: true });
      await fs.writeFile(plist, content);
      if (service) await launchctl('bootout', `${domain}/${label}`);
      await launchctl('bootstrap', domain, plist);
      for (let i = 0; i < 100 && !await running(); i++) await new Promise(r => setTimeout(r, 150));
      if (!await running()) throw new Error(`Paperdesk did not start. See ${path.join(dataDir, 'server.log')}.`);
    }
    console.log(`Paperdesk is running in the background at ${url}. It starts at login; \`paperdesk uninstall\` removes it.`);
    await open();
  },
  async uninstall() {
    if (await loaded()) await launchctl('bootout', `${domain}/${label}`);
    await fs.rm(plist, { force: true });
    console.log('Removed the Paperdesk background service. Your projects and settings are untouched.');
  },
  async help() {
    console.log(`Usage: paperdesk [command]

  start       Run Paperdesk in this terminal and open it (default)
  install     Run Paperdesk in the background, starting at login (macOS)
  uninstall   Remove the background service

Add --no-open to skip opening the browser. Data: ${dataDir}`);
  },
};
const command = process.argv.slice(2).find(a => !a.startsWith('-')) || 'start';
try { await (commands[command] || commands.help)(); }
catch (e) { console.error(e.message); process.exit(1); }
