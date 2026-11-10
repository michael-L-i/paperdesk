import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const port = Number(process.env.PORT || 4317);
// App data lives outside the code, so updating or moving Paperdesk keeps your projects.
const standard = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library/Application Support/Paperdesk')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'paperdesk');
export const dataDir = path.resolve(process.env.PAPERDESK_DATA_DIR || standard);

const exists = file => fs.stat(file).then(() => true, () => false);
export async function prepareDataDir() {
  // Paperdesk 0.1 kept its data in .data/ next to the code; copy it over once.
  const legacy = path.join(appDir, '.data');
  if (dataDir === standard && !await exists(path.join(dataDir, 'projects.json')) && await exists(legacy)) await fs.cp(legacy, dataDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
}
