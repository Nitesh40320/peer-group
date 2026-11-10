// Runs a private PostgreSQL instance for development from locally installed binaries.
// It uses its own data directory and port, so any other PostgreSQL on the machine is untouched.
// Usage: node scripts/local-db.mjs start|stop
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 54329;
const USER = 'peerconnect';
const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
const home = path.join(base, 'PeerConnect');
const dataDir = path.join(home, 'pgdata');
const logFile = path.join(home, 'postgres.log');
const exe = process.platform === 'win32' ? '.exe' : '';

function findBin() {
  const candidates = [process.env.PG_BIN];
  if (process.platform === 'win32') {
    const pf = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(pf)) {
      for (const v of fs.readdirSync(pf).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(pf, v, 'bin'));
    }
  }
  candidates.push('/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
  const found = candidates.find((d) => d && fs.existsSync(path.join(d, `pg_ctl${exe}`)));
  if (!found) {
    console.error('PostgreSQL binaries not found. Set PG_BIN, or use "docker compose up db" and point DATABASE_URL at it.');
    process.exit(1);
  }
  return found;
}

const bin = findBin();
const tool = (name) => path.join(bin, name + exe);
const pgCtl = (...args) => execFileSync(tool('pg_ctl'), ['-D', dataDir, ...args], { stdio: 'pipe' }).toString();
const isRunning = () => {
  try { pgCtl('status'); return true; } catch { return false; }
};

function readEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) fs.copyFileSync(path.join(root, '.env.example'), envPath);
  return { envPath, text: fs.readFileSync(envPath, 'utf8') };
}

function writeUrls(password) {
  const { envPath, text } = readEnv();
  const url = (db) => `postgres://${USER}:${password}@127.0.0.1:${PORT}/${db}`;
  const next = text
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url('peerconnect')}`)
    .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL=${url('peerconnect_test')}`);
  fs.writeFileSync(envPath, next);
}

function init() {
  fs.mkdirSync(home, { recursive: true });
  const password = crypto.randomBytes(18).toString('hex');
  const pwFile = path.join(home, '.pw');
  fs.writeFileSync(pwFile, password, { mode: 0o600 });
  try {
    execFileSync(tool('initdb'), ['-D', dataDir, '-U', USER, '--auth=scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8'], { stdio: 'pipe' });
  } finally {
    fs.rmSync(pwFile, { force: true });
  }
  writeUrls(password);
  return password;
}

function passwordFromEnv() {
  const match = readEnv().text.match(/^DATABASE_URL=postgres:\/\/[^:]+:([^@]+)@/m);
  if (!match || match[1] === 'PASSWORD') {
    console.error('.env has no password for the local database. Restore it, or delete the data directory:', dataDir);
    process.exit(1);
  }
  return match[1];
}

function ensureDatabases(password) {
  const env = { ...process.env, PGPASSWORD: password };
  const psql = (db, sql) =>
    execFileSync(tool('psql'), ['-h', '127.0.0.1', '-p', String(PORT), '-U', USER, '-d', db, '-tAc', sql], { env, stdio: 'pipe' }).toString().trim();
  for (const db of ['peerconnect', 'peerconnect_test']) {
    if (psql('postgres', `select 1 from pg_database where datname='${db}'`) !== '1') {
      psql('postgres', `create database ${db}`);
      console.log(`Created database ${db}`);
    }
  }
}

function start() {
  const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const password = fresh ? init() : passwordFromEnv();
  if (isRunning()) {
    console.log(`PostgreSQL already running on port ${PORT}.`);
  } else {
    // Detached so the database outlives this script; pg_ctl owns the log file.
    const child = spawn(tool('pg_ctl'), ['-D', dataDir, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, '-l', logFile, 'start'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        execFileSync(tool('pg_isready'), ['-h', '127.0.0.1', '-p', String(PORT)], { stdio: 'pipe' });
        break;
      } catch {
        if (Date.now() > deadline) {
          console.error('PostgreSQL did not start. See', logFile);
          process.exit(1);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      }
    }
    console.log(`PostgreSQL started on 127.0.0.1:${PORT}.`);
  }
  ensureDatabases(password);
}

const command = process.argv[2];
if (command === 'start') start();
else if (command === 'stop') {
  if (isRunning()) { pgCtl('stop', '-m', 'fast'); console.log('PostgreSQL stopped.'); } else console.log('PostgreSQL is not running.');
} else {
  console.error('Usage: local-db.mjs start|stop');
  process.exit(1);
}
