// Runs the backend (API) and the frontend (Vite) dev servers together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['backend', 'frontend'].map((w) =>
  spawn(npm, ['run', 'dev', '-w', w], { stdio: 'inherit', shell: process.platform === 'win32' }),
);

function stop() {
  for (const c of children) c.kill();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', stop);
