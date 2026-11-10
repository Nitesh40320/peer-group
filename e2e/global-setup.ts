import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
export const adminFile = path.join(import.meta.dirname, 'test-results', 'admin.json');

export default function globalSetup() {
  const env = { ...process.env, NODE_ENV: 'test' as const, ADMIN_PASSWORD: 'e2e-admin-pass-42' };
  const run = (script: string, args = '') => execSync(`npx tsx --conditions=source --env-file-if-exists=.env backend/src/cli/${script}.ts ${args}`, { cwd: root, env, stdio: 'pipe' });
  run('migrate');
  const email = `admin.${Date.now()}@example.test`;
  run('create-admin', `${email} "E2E Admin"`);
  fs.mkdirSync(path.dirname(adminFile), { recursive: true });
  fs.writeFileSync(adminFile, JSON.stringify({ email, password: env.ADMIN_PASSWORD }));
}
