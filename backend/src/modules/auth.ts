import { hash, verify, Algorithm } from '@node-rs/argon2';
import type { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { HttpError } from '../lib/core.js';
import { hashToken, randomToken, required, route, text, type AuthContext } from '../lib/route.js';
import { audit, disconnectUser, sendEmail } from '../lib/services.js';

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (password: string) => hash(password, ARGON);

// Verifying against this when an account does not exist keeps response times alike.
const dummyHash = hash('peerconnect-timing-placeholder', ARGON);

export const passwordSchema = z.string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use at most 200 characters.')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Use at least one letter and one number.');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.').max(254));

export const registerSchema = z.object({
  fullName: required(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['student', 'teacher']),
  institution: text(160).default(''),
  department: text(160).default(''),
  designation: text(160).default(''),
  statement: text(2000).default(''),
}).superRefine((v, ctx) => {
  if (v.role !== 'teacher') return;
  for (const field of ['institution', 'department', 'designation'] as const) {
    if (!v[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Teachers must provide this for verification.' });
  }
});

const limit = (windowMs: number, limitCount: number) => rateLimit({
  windowMs, limit: limitCount, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => !config.rateLimitEnabled,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
});

const authLimiter = limit(15 * 60 * 1000, 20);
const emailLimiter = limit(60 * 60 * 1000, 10);

const HOUR = 60 * 60 * 1000;

async function issueToken(userId: string, purpose: 'verify_email' | 'reset_password', ttlMs: number) {
  await q('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
  const token = randomToken();
  await q('INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, purpose, hashToken(token), new Date(Date.now() + ttlMs)]);
  return token;
}

async function consumeToken(token: string, purpose: string) {
  const row = await one(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [hashToken(token), purpose]);
  if (!row) throw new HttpError(400, 'INVALID_TOKEN', 'This link is invalid or has expired. Request a new one.');
  return row.userId as string;
}

async function sendVerification(userId: string, email: string) {
  const token = await issueToken(userId, 'verify_email', 48 * HOUR);
  await sendEmail(email, 'Verify your PeerConnect email',
    `Welcome to PeerConnect.\n\nConfirm your email address to activate your account:\n${config.appOrigin}/verify-email?token=${token}\n\nThis link expires in 48 hours.`);
}

function cookieOptions() {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax' as const, path: '/', maxAge: config.sessionTtlMs };
}

async function startSession(res: Response, userId: string) {
  const token = randomToken();
  const csrfToken = randomToken();
  await q('INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, hashToken(token), csrfToken, new Date(Date.now() + config.sessionTtlMs)]);
  res.cookie(config.cookieName, token, cookieOptions());
  return csrfToken;
}

/** Ends every session for a user: used on suspension and password change. */
export async function revokeSessions(userId: string, exceptSessionId?: string) {
  await q('DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)', [userId, exceptSessionId ?? null]);
  if (!exceptSessionId) disconnectUser(userId);
}

const me = (auth: AuthContext) => ({ user: auth.user, csrfToken: auth.csrfToken });

export function authRoutes(router: Router) {
  const tag = 'Authentication';

  route(router, {
    tag, method: 'post', path: '/api/auth/register', summary: 'Create a student or teacher account', access: 'public',
    body: registerSchema, limiter: emailLimiter, status: 202,
    handler: async ({ body, req }) => {
      const setting = await one(`SELECT value FROM platform_settings WHERE key = 'registration_open'`);
      if (setting?.value === false) throw new HttpError(403, 'REGISTRATION_CLOSED', 'Registration is currently closed.');
      const passwordHash = await hashPassword(body.password);
      const created = await tx(async () => {
        const user = await one(
          `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)
           ON CONFLICT (email) DO NOTHING RETURNING id`, [body.email, passwordHash, body.fullName, body.role]);
        if (!user) return null;
        if (body.role === 'student') {
          await q('INSERT INTO student_profiles (user_id, institution, department) VALUES ($1, $2, $3)', [user.id, body.institution, body.department]);
        } else {
          await q('INSERT INTO teacher_profiles (user_id, institution, department, designation) VALUES ($1, $2, $3, $4)',
            [user.id, body.institution, body.department, body.designation]);
          await q('INSERT INTO teacher_verifications (teacher_id, statement) VALUES ($1, $2)', [user.id, body.statement]);
        }
        await q('INSERT INTO notification_preferences (user_id) VALUES ($1)', [user.id]);
        await audit(req, user.id, 'user.registered', 'user', user.id, { role: body.role });
        return user;
      });
      // The response is identical either way, so this endpoint cannot reveal who has an account.
      if (created) await sendVerification(created.id, body.email);
      return { message: 'Check your email for a verification link.' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/verify-email', summary: 'Confirm an email address', access: 'public',
    body: z.object({ token: required(200) }), limiter: authLimiter, status: 200,
    handler: async ({ body }) => {
      const userId = await consumeToken(body.token, 'verify_email');
      await q('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
      return { message: 'Email verified. You can now sign in.' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/resend-verification', summary: 'Send a new verification email', access: 'public',
    body: z.object({ email: emailSchema }), limiter: emailLimiter, status: 202,
    handler: async ({ body }) => {
      const user = await one('SELECT id FROM users WHERE email = $1 AND email_verified_at IS NULL', [body.email]);
      if (user) await sendVerification(user.id, body.email);
      return { message: 'If that account needs verification, an email is on its way.' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/login', summary: 'Sign in', access: 'public',
    body: z.object({ email: emailSchema, password: z.string().min(1).max(200) }), limiter: authLimiter, status: 200,
    handler: async ({ body, res, req }) => {
      const user = await one('SELECT id, password_hash, status, email_verified_at FROM users WHERE email = $1', [body.email]);
      const valid = await verify(user?.passwordHash ?? (await dummyHash), body.password).catch(() => false);
      if (!user || !valid) {
        await audit(req, user?.id ?? null, 'auth.login_failed', 'user', user?.id ?? '');
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
      }
      if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support for help.');
      if (!user.emailVerifiedAt) throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in.');
      const csrfToken = await startSession(res, user.id);
      await audit(req, user.id, 'auth.login', 'user', user.id);
      const publicUser = await one(
        `SELECT u.id, u.email, u.full_name, u.role, u.status, u.avatar_file_id, t.verification_status AS teacher_status
           FROM users u LEFT JOIN teacher_profiles t ON t.user_id = u.id WHERE u.id = $1`, [user.id]);
      return { user: publicUser, csrfToken };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/logout', summary: 'Sign out', access: 'any', status: 200,
    handler: async ({ auth, res }) => {
      await q('DELETE FROM sessions WHERE id = $1', [auth.sessionId]);
      const { maxAge: _unused, ...options } = cookieOptions();
      res.clearCookie(config.cookieName, options);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/forgot-password', summary: 'Email a password reset link', access: 'public',
    body: z.object({ email: emailSchema }), limiter: emailLimiter, status: 202,
    handler: async ({ body }) => {
      const user = await one(`SELECT id FROM users WHERE email = $1 AND status = 'active'`, [body.email]);
      if (user) {
        const token = await issueToken(user.id, 'reset_password', HOUR);
        await sendEmail(body.email, 'Reset your PeerConnect password',
          `Use this link to choose a new password:\n${config.appOrigin}/reset-password?token=${token}\n\nIt expires in 1 hour. If you did not ask for this, ignore this email.`);
      }
      return { message: 'If that account exists, a reset link is on its way.' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/reset-password', summary: 'Set a new password with a reset token', access: 'public',
    body: z.object({ token: required(200), password: passwordSchema }), limiter: authLimiter, status: 200,
    handler: async ({ body, req }) => {
      const passwordHash = await hashPassword(body.password);
      await tx(async () => {
        const userId = await consumeToken(body.token, 'reset_password');
        await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, userId]);
        await revokeSessions(userId);
        await audit(req, userId, 'auth.password_reset', 'user', userId);
      });
      return { message: 'Password updated. You can now sign in.' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/auth/change-password', summary: 'Change password while signed in', access: 'any',
    body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }), limiter: authLimiter, status: 200,
    handler: async ({ body, auth, req }) => {
      const row = await one('SELECT password_hash FROM users WHERE id = $1', [auth.user.id]);
      if (!(await verify(row.passwordHash, body.currentPassword).catch(() => false))) {
        throw new HttpError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.');
      }
      await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await hashPassword(body.newPassword), auth.user.id]);
      await revokeSessions(auth.user.id, auth.sessionId);
      await audit(req, auth.user.id, 'auth.password_changed', 'user', auth.user.id);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/auth/me', summary: 'Current user and CSRF token', access: 'any',
    handler: async ({ auth }) => me(auth),
  });
}

