import { spawn } from 'node:child_process';
export function run(command, args, { cwd, input, timeout = 180000, onOutput, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', timedOut = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    // Streamed output goes to onOutput instead of accumulating.
    child.stdout.on('data', data => { if (onOutput) return onOutput(data.toString()); stdout += data; if (stdout.length > 8_000_000) kill(); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-20000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `${command} is not installed or not on PATH.` : e.message)); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(timedOut ? `${command} timed out. Try again with a smaller document.` : (stderr || stdout || `${command} exited with ${code}`).slice(-12000))); });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
