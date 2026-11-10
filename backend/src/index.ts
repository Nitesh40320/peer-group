import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { startJobs } from './jobs.js';
import { log, reportError } from './lib/core.js';
import { attachRealtime } from './lib/services.js';

const server = http.createServer(createApp());
const wss = attachRealtime(server);
const stopJobs = startJobs();

server.listen(config.port, () => log.info('PeerConnect server listening', { port: config.port, env: config.env }));

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info('Shutting down', { signal });
  stopJobs();
  wss.clients.forEach((c) => c.close(1001, 'Server restarting'));
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => reportError(reason, { where: 'unhandledRejection' }));
