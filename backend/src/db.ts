import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

const txStore = new AsyncLocalStorage<pg.PoolClient>();

const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function camelize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) out[toCamel(key)] = row[key];
  return out;
}

/** Runs a parameterized query, joining the surrounding transaction if there is one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = txStore.getStore() ?? pool;
  const result = await client.query(text, params as unknown[]);
  return result.rows.map(camelize) as T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Applies backend/migrations/*.sql in filename order, each once, each in a transaction. */
export async function migrate(log: (m: string) => void = () => undefined) {
  const dir = path.resolve(import.meta.dirname, '..', 'migrations');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727401)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(name)) continue;
      log(`Applying ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, name), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727401)');
    client.release();
  }
}
