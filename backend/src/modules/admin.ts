// Administration, moderation, support requests and public platform metadata.
import type { Router } from 'express';
import { z } from 'zod';
import { one, pool, q, tx } from '../db.js';
import { config } from '../config.js';
import { badRequest, forbidden, notFound } from '../lib/core.js';
import { idParam, offset, paged, pageQuery, required, route, text } from '../lib/route.js';
import { audit, emailConfigured, notify } from '../lib/services.js';
import { revokeSessions, emailSchema } from './auth.js';
import { aiAvailable } from './ai.js';

const ADMIN: ['admin'] = ['admin'];
const tag = 'Administration';

/** The access rules enforced by route(); shown read-only to administrators. */
const PERMISSIONS = [
  { capability: 'Discover students, join groups, messaging, sessions, resources', student: true, teacher: 'Approved only', admin: false },
  { capability: 'Request mentorship, submit assignments, track progress', student: true, teacher: false, admin: false },
  { capability: 'Create academic communities, assignments, mentor students', student: false, teacher: 'Approved only', admin: false },
  { capability: 'Verify teachers, suspend accounts, moderate reports', student: false, teacher: false, admin: true },
];

export function adminRoutes(router: Router) {
  route(router, {
    tag, method: 'get', path: '/api/admin/dashboard', summary: 'Platform overview', access: ADMIN,
    handler: async () => {
      const stats = await one(`SELECT (SELECT count(*)::int FROM users) AS total_users,
          (SELECT count(*)::int FROM users WHERE role = 'student' AND status = 'active') AS active_students,
          (SELECT count(*)::int FROM users WHERE role = 'teacher' AND status = 'active') AS active_teachers,
          (SELECT count(*)::int FROM teacher_profiles WHERE verification_status = 'pending') AS pending_verifications,
          (SELECT count(*)::int FROM study_groups WHERE deleted_at IS NULL) AS active_groups,
          (SELECT count(*)::int FROM reports WHERE status IN ('open', 'reviewing')) AS pending_reports,
          (SELECT count(*)::int FROM support_requests WHERE status = 'open') AS open_support`);
      const activity = await q(`SELECT a.id, a.action, a.target_type, a.created_at, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action NOT LIKE 'auth.%' ORDER BY a.created_at DESC LIMIT 10`);
      return { stats, activity };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/users', summary: 'Search users', access: ADMIN,
    query: pageQuery.extend({ q: text(80).default(''), role: z.enum(['student', 'teacher', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional() }),
    handler: async ({ query }) => {
      const term = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : '';
      const rows = await q(`SELECT u.id, u.full_name, u.email, u.role, u.status, u.email_verified_at, u.created_at, t.verification_status, count(*) OVER()::int AS total_count
        FROM users u LEFT JOIN teacher_profiles t ON t.user_id = u.id
        WHERE ($1 = '' OR lower(u.full_name) LIKE lower($1) OR u.email LIKE lower($1)) AND ($2::text IS NULL OR u.role = $2) AND ($3::text IS NULL OR u.status = $3)
        ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`, [term, query.role ?? null, query.status ?? null, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/admin/users/:id/status', summary: 'Suspend or reactivate an account', access: ADMIN, params: idParam,
    body: z.object({ status: z.enum(['active', 'suspended']), reason: text(500).default('') }),
    handler: async ({ user, params, body, req }) => {
      if (params.id === user.id) throw badRequest('You cannot change your own account status.');
      const target = await one('SELECT role FROM users WHERE id = $1', [params.id]);
      if (!target) throw notFound('User');
      if (target.role === 'admin') throw forbidden('Administrator accounts cannot be changed here.');
      await tx(async () => {
        await q('UPDATE users SET status = $1, updated_at = now() WHERE id = $2', [body.status, params.id]);
        if (body.status === 'suspended') await revokeSessions(params.id);
        await audit(req, user.id, `user.${body.status === 'suspended' ? 'suspended' : 'reactivated'}`, 'user', params.id, { reason: body.reason });
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/verifications', summary: 'Teacher verification queue', access: ADMIN,
    query: pageQuery.extend({ status: z.enum(['pending', 'approved', 'rejected', 'needs_info']).default('pending') }),
    handler: async ({ query }) => {
      const rows = await q(`SELECT DISTINCT ON (v.teacher_id) v.id, v.statement, v.status, v.decision_note, v.created_at, v.document_file_id, f.original_name AS document_name,
            u.id AS teacher_id, u.full_name, u.email, p.institution, p.department, p.designation, p.verification_status
          FROM teacher_verifications v JOIN users u ON u.id = v.teacher_id JOIN teacher_profiles p ON p.user_id = u.id LEFT JOIN files f ON f.id = v.document_file_id
          WHERE p.verification_status = $1 ORDER BY v.teacher_id, v.created_at DESC`, [query.status]);
      const start = offset(query);
      return { items: rows.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / query.pageSize)) };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/admin/teachers/:id/verification', summary: 'Decide a teacher verification', access: ADMIN, params: idParam,
    body: z.object({ status: z.enum(['approved', 'rejected', 'needs_info']), note: text(1000).default('') }),
    handler: async ({ user, params, body, req }) => {
      if (body.status !== 'approved' && !body.note) throw badRequest('Add a note explaining this decision to the teacher.');
      await tx(async () => {
        const profile = await one('UPDATE teacher_profiles SET verification_status = $1, updated_at = now() WHERE user_id = $2 RETURNING user_id', [body.status, params.id]);
        if (!profile) throw notFound('Teacher');
        await q(`UPDATE teacher_verifications SET status = $1, reviewer_id = $2, decision_note = $3, decided_at = now()
          WHERE id = (SELECT id FROM teacher_verifications WHERE teacher_id = $4 ORDER BY created_at DESC LIMIT 1)`, [body.status, user.id, body.note, params.id]);
        await audit(req, user.id, 'teacher.verification_decided', 'user', params.id, { status: body.status });
      });
      const label = { approved: 'approved', rejected: 'not approved', needs_info: 'waiting for more information' }[body.status];
      await notify(params.id, 'teacher_verification', { title: `Your teacher verification is ${label}`, body: body.note, link: '/app/verification' });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/reports', summary: 'Moderation reports', access: ADMIN,
    query: pageQuery.extend({ status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional() }),
    handler: async ({ query }) => {
      const rows = await q(`SELECT r.*, u.full_name AS reporter_name,
          COALESCE((SELECT json_agg(json_build_object('id', e.id, 'status', e.status, 'note', e.note, 'createdAt', e.created_at, 'admin', a.full_name) ORDER BY e.created_at) FROM report_events e LEFT JOIN users a ON a.id = e.admin_id WHERE e.report_id = r.id), '[]') AS history,
          count(*) OVER()::int AS total_count FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [query.status ?? null, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/admin/reports/:id', summary: 'Update a report with a review note', access: ADMIN, params: idParam,
    body: z.object({ status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']), note: text(2000).default('') }),
    handler: async ({ user, params, body, req }) => {
      await tx(async () => {
        const row = await one('UPDATE reports SET status = $1, updated_at = now() WHERE id = $2 RETURNING id', [body.status, params.id]);
        if (!row) throw notFound('Report');
        await q('INSERT INTO report_events (report_id, admin_id, status, note) VALUES ($1, $2, $3, $4)', [params.id, user.id, body.status, body.note]);
        await audit(req, user.id, 'report.updated', 'report', params.id, { status: body.status });
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/audit', summary: 'Audit log', access: ADMIN, query: pageQuery,
    handler: async ({ query }) => paged(await q(`SELECT a.*, u.full_name AS actor_name, count(*) OVER()::int AS total_count FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [query.pageSize, offset(query)]), query),
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/support', summary: 'Support requests', access: ADMIN,
    query: pageQuery.extend({ status: z.enum(['open', 'closed']).default('open') }),
    handler: async ({ query }) => paged(await q(`SELECT *, count(*) OVER()::int AS total_count FROM support_requests WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [query.status, query.pageSize, offset(query)]), query),
  });

  route(router, {
    tag, method: 'patch', path: '/api/admin/support/:id', summary: 'Open or close a support request', access: ADMIN, params: idParam,
    body: z.object({ status: z.enum(['open', 'closed']) }),
    handler: async ({ user, params, body, req }) => {
      const row = await one('UPDATE support_requests SET status = $1 WHERE id = $2 RETURNING id', [body.status, params.id]);
      if (!row) throw notFound('Request');
      await audit(req, user.id, 'support.updated', 'support', params.id, { status: body.status });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/admin/system', summary: 'Settings, permissions and non-sensitive system health', access: ADMIN,
    handler: async () => {
      const settings = Object.fromEntries((await q('SELECT key, value FROM platform_settings')).map((s) => [s.key, s.value]));
      const dbOk = !!(await one('SELECT 1 AS ok'));
      return {
        settings, permissions: PERMISSIONS,
        health: {
          database: dbOk ? 'ok' : 'error', email: emailConfigured() ? 'smtp' : 'development console', ai: aiAvailable() ? 'configured' : 'not configured',
          storage: 'local disk', environment: config.env, uptimeSeconds: Math.round(process.uptime()), connections: pool.totalCount,
        },
      };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/admin/settings', summary: 'Update platform settings', access: ADMIN,
    body: z.object({ registration_open: z.boolean(), ai_enabled: z.boolean(), announcement_banner: text(300) }).partial(),
    handler: async ({ user, body, req }) => {
      await tx(async () => {
        for (const [key, value] of Object.entries(body)) {
          await q('UPDATE platform_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1', [key, JSON.stringify(value), user.id]);
        }
        await audit(req, user.id, 'settings.updated', 'settings', '', body);
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/admin/broadcast', summary: 'Send an in-app announcement to a role', access: ADMIN,
    body: z.object({ audience: z.enum(['all', 'student', 'teacher']), title: required(160), body: text(1000).default('') }),
    handler: async ({ user, body, req }) => {
      const result = await q(`INSERT INTO notifications (user_id, type, title, body) SELECT id, 'announcement', $1, $2 FROM users WHERE status = 'active' AND role <> 'admin' AND ($3 = 'all' OR role = $3) RETURNING id`, [body.title, body.body, body.audience]);
      await audit(req, user.id, 'notification.broadcast', 'notification', '', { audience: body.audience, count: result.length });
      return { delivered: result.length };
    },
  });

  // Available to every signed-in user --------------------------------------

  route(router, {
    tag: 'Moderation', method: 'post', path: '/api/reports', summary: 'Report a user, group, message or resource', access: 'any',
    body: z.object({ targetType: z.enum(['user', 'group', 'message', 'resource']), targetId: z.uuid(), reason: required(160), details: text(2000).default('') }),
    handler: async ({ user, body }) => one('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5) RETURNING id', [user.id, body.targetType, body.targetId, body.reason, body.details]),
  });

  route(router, {
    tag: 'Support', method: 'post', path: '/api/support', summary: 'Contact support', access: 'public',
    body: z.object({ name: required(120), email: emailSchema, category: z.enum(['general', 'problem', 'account']), message: required(4000) }),
    handler: async ({ body }) => {
      await q('INSERT INTO support_requests (name, email, category, message) VALUES ($1, $2, $3, $4)', [body.name, body.email, body.category, body.message]);
      return { message: 'Thanks. Our team will reply by email.' };
    },
  });

  route(router, {
    tag: 'Support', method: 'get', path: '/api/meta', summary: 'Public platform settings', access: 'public',
    handler: async () => {
      const rows = await q(`SELECT key, value FROM platform_settings WHERE key IN ('registration_open', 'announcement_banner')`);
      return Object.fromEntries(rows.map((s) => [s.key, s.value]));
    },
  });
}
