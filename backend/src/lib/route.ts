// Every API endpoint is declared through route(). That keeps authentication, CSRF checks,
// validation and the OpenAPI document in one place, so an endpoint cannot skip them.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { forbidden, HttpError } from './core.js';

export type Role = 'student' | 'teacher' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: 'active' | 'suspended';
  avatarFileId: string | null;
  teacherStatus: 'pending' | 'approved' | 'rejected' | 'needs_info' | null;
}

export interface AuthContext { user: AuthUser; sessionId: string; csrfToken: string }

declare module 'express-serve-static-core' {
  interface Request { auth?: AuthContext }
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** Resolves a session cookie to an active user, or null. Suspended users have no valid session. */
export async function loadSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const row = await one(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, u.id, u.email, u.full_name, u.role, u.status,
            u.avatar_file_id, t.verification_status AS teacher_status
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN teacher_profiles t ON t.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row || row.status !== 'active') return null;
  if (Date.now() - new Date(row.lastSeenAt).getTime() > 5 * 60 * 1000) {
    await q('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.sessionId]);
  }
  const { sessionId, csrfToken, lastSeenAt: _ignored, ...user } = row;
  return { user: user as AuthUser, sessionId, csrfToken };
}

/** 'public' needs no session; 'any' needs one; a list names the roles allowed. */
export type Access = 'public' | 'any' | Array<'student' | 'teacher' | 'approved_teacher' | 'admin'>;

/** Students and teachers an administrator has approved: the people who collaborate. */
export const COLLABORATORS: Access = ['student', 'approved_teacher'];

export function isAllowed(user: Pick<AuthUser, 'role' | 'teacherStatus'>, access: Exclude<Access, 'public' | 'any'>) {
  return access.some((entry) => {
    if (entry === 'approved_teacher') return user.role === 'teacher' && user.teacherStatus === 'approved';
    return entry === user.role;
  });
}

interface Definition<B extends z.ZodType, Qu extends z.ZodType, P extends z.ZodType> {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  tag: string;
  access: Access;
  body?: B;
  query?: Qu;
  params?: P;
  /** Accept a multipart form with this file field; the fields are validated by body. */
  upload?: string;
  limiter?: (req: Request, res: Response, next: NextFunction) => void;
  status?: number;
  raw?: boolean;
  handler: (ctx: {
    req: Request;
    res: Response;
    auth: AuthContext;
    user: AuthUser;
    body: z.output<B>;
    query: z.output<Qu>;
    params: z.output<P>;
    file?: Express.Multer.File;
  }) => Promise<unknown>;
}

interface OpenApiEntry { method: string; path: string; summary: string; tag: string; access: Access; body?: z.ZodType; query?: z.ZodType; params?: z.ZodType; upload?: string; status: number }
export const openApiEntries: OpenApiEntry[] = [];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
const SAFE_METHODS = new Set(['get', 'head', 'options']);

function parse<S extends z.ZodType>(schema: S | undefined, value: unknown, where: string): z.output<S> {
  if (!schema) return undefined as z.output<S>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new HttpError(422, 'VALIDATION_ERROR', `Some ${where} values are invalid.`,
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function route<B extends z.ZodType = z.ZodUnknown, Qu extends z.ZodType = z.ZodUnknown, P extends z.ZodType = z.ZodUnknown>(
  router: Router,
  def: Definition<B, Qu, P>,
) {
  const status = def.status ?? (def.method === 'post' ? 201 : 200);
  openApiEntries.push({ method: def.method, path: def.path, summary: def.summary, tag: def.tag, access: def.access, body: def.body, query: def.query, params: def.params, upload: def.upload, status });

  const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    if (def.access === 'public') return next();
    const auth = await loadSession(req.cookies?.[config.cookieName]);
    if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    if (!SAFE_METHODS.has(def.method)) {
      const sent = req.get('x-csrf-token') ?? '';
      const a = Buffer.from(sent);
      const b = Buffer.from(auth.csrfToken);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'CSRF_FAILED', 'Your session has expired. Refresh the page and try again.');
    }
    if (def.access !== 'any' && !isAllowed(auth.user, def.access)) {
      if (auth.user.role === 'teacher' && def.access.includes('approved_teacher')) {
        throw forbidden('This feature is available once your teacher account is approved.');
      }
      throw forbidden();
    }
    req.auth = auth;
    next();
  };

  const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!def.upload) return next();
    upload.single(def.upload)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        next(err.code === 'LIMIT_FILE_SIZE'
          ? new HttpError(413, 'FILE_TOO_LARGE', `Files must be ${Math.round(config.maxUploadBytes / 1048576)} MB or smaller.`)
          : new HttpError(400, 'BAD_UPLOAD', 'That upload could not be processed.'));
      } else next(err as Error | undefined);
    });
  };

  const handle = async (req: Request, res: Response) => {
    const result = await def.handler({
      req, res,
      auth: req.auth as AuthContext,
      user: req.auth?.user as AuthUser,
      body: parse(def.body, req.body, 'form'),
      query: parse(def.query, req.query, 'query'),
      params: parse(def.params, req.params, 'path'),
      file: req.file,
    });
    if (def.raw) return;
    res.status(status).json(result ?? { ok: true });
  };

  const middleware = [...(def.limiter ? [def.limiter] : []), authenticate, uploadMiddleware, handle];
  router[def.method](def.path, ...middleware);
}

// Shared schemas -----------------------------------------------------------

export const idParam = z.object({ id: z.uuid() });
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const offset = (p: { page: number; pageSize: number }) => (p.page - 1) * p.pageSize;

/** Builds a page from rows selected with `count(*) OVER()::int AS total_count`. */
export function paged<T extends { totalCount?: number }>(rows: T[], p: { page: number; pageSize: number }) {
  const total = rows[0]?.totalCount ?? 0;
  return { items: rows.map(({ totalCount: _omit, ...r }) => r), page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Plain text with outer whitespace removed. Output encoding happens where it is rendered. */
export const text = (max: number) => z.string().trim().max(max);
export const required = (max: number) => z.string().trim().min(1, 'This field is required.').max(max);
export const csv = z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : []));
export const topicList = z.array(z.string().trim().min(1).max(80)).max(30);
export const isoDate = z.iso.datetime({ offset: true });
