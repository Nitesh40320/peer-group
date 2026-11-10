import path from 'node:path';
import { z } from 'zod';

const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optional = z.preprocess(blankToUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: optional,
  TEST_DATABASE_URL: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  EMAIL_FROM: z.string().default('PeerConnect <no-reply@example.com>'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(20),
  ERROR_WEBHOOK_URL: optional,
  RATE_LIMIT_DISABLED: z.preprocess(blankToUndefined, z.enum(['0', '1']).optional()),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Names only: values may be secrets.
  const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${names}`);
}
const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';
const databaseUrl = env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL;

const problems: string[] = [];
if (!databaseUrl) problems.push(env.NODE_ENV === 'test' ? 'TEST_DATABASE_URL is required' : 'DATABASE_URL is required');
if (isProduction) {
  if (!env.SMTP_HOST) problems.push('SMTP_HOST is required in production: account emails cannot be delivered without it');
  if (!env.APP_ORIGIN.startsWith('https://')) problems.push('APP_ORIGIN must use https in production');
  if (env.RATE_LIMIT_DISABLED === '1') problems.push('RATE_LIMIT_DISABLED cannot be used in production');
}
if (problems.length) throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);

export const config = {
  env: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY,
  logLevel: env.LOG_LEVEL,
  databaseUrl: databaseUrl as string,
  smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD } : null,
  emailFrom: env.EMAIL_FROM,
  storageDir: path.resolve(env.STORAGE_DIR),
  maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  ai: { apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL, dailyLimit: env.AI_DAILY_LIMIT },
  errorWebhookUrl: env.ERROR_WEBHOOK_URL,
  rateLimitEnabled: env.RATE_LIMIT_DISABLED !== '1' && env.NODE_ENV !== 'test',
  sessionTtlMs: 14 * 24 * 60 * 60 * 1000,
  cookieName: isProduction ? '__Host-pc_session' : 'pc_session',
} as const;
