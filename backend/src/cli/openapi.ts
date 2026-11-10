// Generates docs/openapi.json from the routes the server actually registers.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createApp } from '../app.js';
import { pool } from '../db.js';
import { openApiEntries } from '../lib/route.js';

createApp();

const schemaOf = (s: z.ZodType) => z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
const paths: Record<string, Record<string, unknown>> = {};

for (const e of openApiEntries) {
  const oaPath = e.path.replace(/:(\w+)/g, '{$1}');
  const parameters: unknown[] = [];
  for (const [source, where] of [[e.params, 'path'], [e.query, 'query']] as const) {
    if (!source) continue;
    const props = (schemaOf(source).properties ?? {}) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(props)) parameters.push({ name, in: where, required: where === 'path', schema });
  }
  const access = typeof e.access === 'string' ? e.access : e.access.join(', ');
  paths[oaPath] ??= {};
  paths[oaPath][e.method] = {
    tags: [e.tag], summary: e.summary, description: `Access: ${access}`, parameters,
    ...(e.body || e.upload ? {
      requestBody: {
        content: {
          [e.upload ? 'multipart/form-data' : 'application/json']: {
            schema: e.upload
              ? { type: 'object', properties: { [e.upload]: { type: 'string', format: 'binary' }, ...((e.body ? schemaOf(e.body).properties : {}) as object) } }
              : schemaOf(e.body as z.ZodType),
          },
        },
      },
    } : {}),
    responses: { [e.status]: { description: 'Success' }, default: { description: 'Error: { error: { code, message, details? } }' } },
  };
}

const target = path.resolve(import.meta.dirname, '../../../docs/openapi.json');
fs.writeFileSync(target, `${JSON.stringify({ openapi: '3.1.0', info: { title: 'PeerConnect API', version: '1.0.0' }, paths }, null, 2)}\n`);
console.log(`Wrote ${openApiEntries.length} operations to docs/openapi.json`);
await pool.end();
