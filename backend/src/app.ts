import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, log, reportError } from './lib/core.js';
import { devOutbox, emailConfigured } from './lib/services.js';
import { adminRoutes } from './modules/admin.js';
import { aiRoutes } from './modules/ai.js';
import { authRoutes } from './modules/auth.js';
import { collaborationRoutes } from './modules/collaboration.js';
import { groupRoutes } from './modules/groups.js';
import { guidanceRoutes } from './modules/guidance.js';
import { peopleRoutes } from './modules/people.js';

const CLIENT_DIST = path.resolve(import.meta.dirname, '../../frontend/dist');

// The pre-transformation static pages; old bookmarks keep working.
const LEGACY_REDIRECTS: Record<string, string> = {
  '/index.html': '/', '/features.html': '/#how-it-works', '/advantages.html': '/#benefits', '/testimonials.html': '/', '/contact.html': '/help',
  '/login.html': '/login', '/signup.html': '/register', '/forgot-password.html': '/forgot-password',
  '/feature-matching.html': '/#how-it-works', '/start-connecting.html': '/register', '/code.html': '/',
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", ...(config.isProduction ? [config.appOrigin.replace(/^http/, 'ws')] : ['ws:'])],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    strictTransportSecurity: config.isProduction,
  }));
  app.use(compression());

  if (config.corsOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && config.corsOrigins.includes(origin)) {
        res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-csrf-token', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE', Vary: 'Origin' });
        if (req.method === 'OPTIONS') return void res.sendStatus(204);
      }
      next();
    });
  }

  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) app.get(from, (_req, res) => res.redirect(301, to));

  // Registered before the limiter so load balancers are never throttled. Reveals nothing internal.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api', rateLimit({
    windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => !config.rateLimitEnabled,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const router = express.Router();
  authRoutes(router);
  peopleRoutes(router);
  groupRoutes(router);
  collaborationRoutes(router);
  guidanceRoutes(router);
  adminRoutes(router);
  aiRoutes(router);
  app.use(router);

  // Lets automated tests and local development read verification links. It exists only when
  // SMTP is not configured and never in production, which refuses to start without SMTP.
  if (!config.isProduction && !emailConfigured()) {
    app.get('/api/dev/outbox', (req, res) => {
      const to = String(req.query.email ?? '').toLowerCase();
      res.json({ items: devOutbox.filter((m) => m.to === to) });
    });
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'That endpoint does not exist.')));

  if (fs.existsSync(CLIENT_DIST)) {
    app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(CLIENT_DIST, 'index.html')); });
  }

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    const parseFailure = error instanceof SyntaxError && 'body' in error;
    if (parseFailure) {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request could not be read.' } });
      return;
    }
    if ((error as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That request is too large.' } });
      return;
    }
    reportError(error, { method: req.method, path: req.path });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });

  log.debug('Application configured');
  return app;
}
