import { config } from '../config.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);

const levels = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: keyof typeof levels, message: string, data?: Record<string, unknown>) {
  if (levels[level] < levels[config.logLevel] || config.isTest) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...data });
  if (level === 'error') console.error(line); else console.log(line);
}

export const log = {
  debug: (m: string, d?: Record<string, unknown>) => write('debug', m, d),
  info: (m: string, d?: Record<string, unknown>) => write('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => write('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => write('error', m, d),
};

/** Logs an unexpected error and forwards it to the monitoring webhook when one is configured. */
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
  log.error('Unhandled error', { ...context, error: err });
  if (config.errorWebhookUrl) {
    fetch(config.errorWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: config.env, time: new Date().toISOString(), context, error: { name: err.name, message: err.message } }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
}
