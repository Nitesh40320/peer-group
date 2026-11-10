// Profiles, discovery, matching, connections, blocks, topics and file downloads.
import type { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/core.js';
import { COLLABORATORS, csv, idParam, offset, paged, pageQuery, required, route, text, topicList, type AuthUser } from '../lib/route.js';
import { NOTIFICATION_TYPES, notify, saveUpload, storage } from '../lib/services.js';
import { activeMatcher, type MatchProfile } from '@peerconnect/model';
import { AVAILABILITY_SLOTS, LEARNING_METHODS, studentProfileCompletion } from './rules.js';

const tag = 'Profiles';
const TOPIC_AGG = (kind: string, alias = 'u.id') => `COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = ${alias} AND t.kind = '${kind}'), '{}')`;
const TOPICS = `${TOPIC_AGG('subject')} AS subjects, ${TOPIC_AGG('skill')} AS skills, ${TOPIC_AGG('interest')} AS interests`;

export async function topicIds(kind: 'subject' | 'skill' | 'interest', names: string[]) {
  if (!names.length) return [] as string[];
  const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
  await q(`INSERT INTO topics (kind, name) SELECT $1, unnest($2::text[]) ON CONFLICT (kind, lower(name)) DO NOTHING`, [kind, unique]);
  const rows = await q('SELECT id FROM topics WHERE kind = $1 AND lower(name) = ANY($2)', [kind, unique.map((n) => n.toLowerCase())]);
  return rows.map((r) => r.id as string);
}

async function replaceUserTopics(userId: string, kind: 'subject' | 'skill' | 'interest', names: string[]) {
  const ids = await topicIds(kind, names);
  await q('DELETE FROM user_topics WHERE user_id = $1 AND topic_id IN (SELECT id FROM topics WHERE kind = $2)', [userId, kind]);
  if (ids.length) await q('INSERT INTO user_topics (user_id, topic_id) SELECT $1, unnest($2::uuid[])', [userId, ids]);
}

export const isBlockedBetween = async (a: string, b: string) =>
  !!(await one('SELECT 1 AS x FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [a, b]));

export const areConnected = async (a: string, b: string) =>
  !!(await one(`SELECT 1 AS x FROM connections WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`, [a, b]));

export async function studentProfile(userId: string) {
  return one(`SELECT u.id, u.full_name, u.email, u.role, u.avatar_file_id, p.institution, p.department, p.academic_year, p.bio,
      p.learning_goals, p.learning_methods, p.availability, p.visibility, ${TOPICS}
      FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]);
}

async function teacherProfile(userId: string) {
  return one(`SELECT u.id, u.full_name, u.email, u.role, u.avatar_file_id, p.institution, p.department, p.designation, p.bio, p.experience,
      p.verification_status, ${TOPICS} FROM users u JOIN teacher_profiles p ON p.user_id = u.id WHERE u.id = $1`, [userId]);
}

const patchSchema = z.object({
  fullName: required(120),
  institution: text(160),
  department: text(160),
  bio: text(2000),
  subjects: topicList,
  skills: topicList,
  interests: topicList,
  academicYear: z.number().int().min(1).max(8).nullable(),
  learningGoals: text(2000),
  learningMethods: z.array(z.enum(LEARNING_METHODS)).max(8),
  availability: z.array(z.string().refine((s) => AVAILABILITY_SLOTS.includes(s), 'Unknown availability slot.')).max(21),
  visibility: z.enum(['everyone', 'connections', 'hidden']),
  designation: text(160),
  experience: text(2000),
}).partial();

const CONNECTION_STATE = `(SELECT json_build_object('id', c.id, 'status', c.status, 'requesterId', c.requester_id) FROM connections c
    WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(u.id, $1::uuid) AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(u.id, $1::uuid)
      AND c.status <> 'rejected') AS connection`;
const NOT_BLOCKED = `NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))`;

const toMatchProfile = (r: { subjects: string[]; skills: string[]; interests: string[]; learningGoals: string; learningMethods: string[]; availability: string[] }): MatchProfile => ({
  subjects: r.subjects, skills: r.skills, interests: r.interests, learningGoals: r.learningGoals, learningMethods: r.learningMethods, availability: r.availability,
});

/** Scores up to 300 discoverable students who share something with this one. */
export async function recommendPartners(userId: string, limit: number) {
  const me = await studentProfile(userId);
  if (!me) return [];
  const rows = await q(
    `SELECT u.id, u.full_name, u.avatar_file_id, p.institution, p.department, p.academic_year, p.learning_goals, p.learning_methods, p.availability, ${TOPICS}, ${CONNECTION_STATE}
       FROM users u JOIN student_profiles p ON p.user_id = u.id
      WHERE u.id <> $1 AND u.status = 'active' AND u.email_verified_at IS NOT NULL AND p.visibility = 'everyone' AND ${NOT_BLOCKED}
      ORDER BY (SELECT count(*) FROM user_topics a JOIN user_topics b ON a.topic_id = b.topic_id WHERE a.user_id = $1 AND b.user_id = u.id) DESC, u.created_at DESC
      LIMIT 300`, [userId]);
  return rows.filter((r) => !r.connection)
    .map((r) => {
      const { learningGoals: _g, availability: _a, learningMethods: _m, connection: _c, ...card } = r;
      return { ...card, ...activeMatcher.score(toMatchProfile(me), toMatchProfile(r)) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function canAccessFile(user: AuthUser, fileId: string) {
  const file = await one('SELECT * FROM files WHERE id = $1', [fileId]);
  if (!file) throw notFound('File');
  if (file.ownerId === user.id) return file;
  const member = 'SELECT 1 FROM group_members gm WHERE gm.group_id = r.group_id AND gm.user_id = $2';
  const checks: Record<string, () => Promise<unknown>> = {
    avatar: async () => true,
    verification: async () => user.role === 'admin',
    resource: () => one(`SELECT 1 AS x FROM resources r JOIN files f ON f.id = r.file_id WHERE r.file_id = $1 AND (r.group_id IS NULL OR EXISTS (${member}))`, [fileId, user.id]),
    message: () => one(`SELECT 1 AS x FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE m.file_id = $1 AND cm.user_id = $2`, [fileId, user.id]),
    submission: () => one(`SELECT 1 AS x FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.file_id = $1 AND a.teacher_id = $2`, [fileId, user.id]),
  };
  if (!(await checks[file.purpose]())) throw forbidden();
  return file;
}

export function peopleRoutes(router: Router) {
  route(router, {
    tag, method: 'get', path: '/api/topics', summary: 'Search subjects, skills and interests', access: 'any',
    query: z.object({ kind: z.enum(['subject', 'skill', 'interest']), q: text(80).default('') }),
    handler: async ({ query }) => ({
      items: (await q(`SELECT name FROM topics WHERE kind = $1 AND lower(name) LIKE lower($2) ORDER BY name LIMIT 30`, [query.kind, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`])).map((r) => r.name),
    }),
  });

  route(router, {
    tag, method: 'get', path: '/api/users/me', summary: 'My full profile', access: 'any',
    handler: async ({ user }) => {
      if (user.role === 'student') {
        const profile = await studentProfile(user.id);
        return { ...profile, completion: studentProfileCompletion(profile) };
      }
      if (user.role === 'teacher') return teacherProfile(user.id);
      return { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/users/me', summary: 'Update my profile', access: 'any', body: patchSchema,
    handler: async ({ user, body }) => {
      await tx(async () => {
        if (body.fullName) await q('UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2', [body.fullName, user.id]);
        if (user.role === 'student') {
          await q(`UPDATE student_profiles SET institution = COALESCE($2, institution), department = COALESCE($3, department), bio = COALESCE($4, bio),
              academic_year = CASE WHEN $5 THEN $6::smallint ELSE academic_year END, learning_goals = COALESCE($7, learning_goals),
              learning_methods = COALESCE($8, learning_methods), availability = COALESCE($9, availability), visibility = COALESCE($10, visibility), updated_at = now()
            WHERE user_id = $1`, [user.id, body.institution ?? null, body.department ?? null, body.bio ?? null, body.academicYear !== undefined, body.academicYear ?? null,
            body.learningGoals ?? null, body.learningMethods ?? null, body.availability ?? null, body.visibility ?? null]);
        } else if (user.role === 'teacher') {
          await q(`UPDATE teacher_profiles SET institution = COALESCE($2, institution), department = COALESCE($3, department), bio = COALESCE($4, bio),
              designation = COALESCE($5, designation), experience = COALESCE($6, experience), updated_at = now() WHERE user_id = $1`,
            [user.id, body.institution ?? null, body.department ?? null, body.bio ?? null, body.designation ?? null, body.experience ?? null]);
        }
        if (user.role !== 'admin') {
          for (const [field, kind] of [['subjects', 'subject'], ['skills', 'skill'], ['interests', 'interest']] as const) {
            if (body[field]) await replaceUserTopics(user.id, kind, body[field]);
          }
        }
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/users/me/avatar', summary: 'Upload a profile photo', access: 'any', upload: 'file',
    handler: async ({ user, file }) => {
      if (!file) throw badRequest('Choose an image to upload.');
      const saved = await saveUpload(user.id, file, 'avatar');
      await q('UPDATE users SET avatar_file_id = $1, updated_at = now() WHERE id = $2', [saved.id, user.id]);
      return { avatarFileId: saved.id };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/users/me/preferences', summary: 'My notification preferences', access: 'any',
    handler: async ({ user }) => {
      const row = await one('SELECT muted_types, email_types FROM notification_preferences WHERE user_id = $1', [user.id]);
      return { mutedTypes: row?.mutedTypes ?? [], emailTypes: row?.emailTypes ?? [], types: NOTIFICATION_TYPES };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/users/me/preferences', summary: 'Update notification preferences', access: 'any',
    body: z.object({ mutedTypes: z.array(z.enum(NOTIFICATION_TYPES)), emailTypes: z.array(z.enum(NOTIFICATION_TYPES)) }),
    handler: async ({ user, body }) => {
      await q(`INSERT INTO notification_preferences (user_id, muted_types, email_types) VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET muted_types = $2, email_types = $3, updated_at = now()`, [user.id, body.mutedTypes, body.emailTypes]);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/users/:id', summary: 'View a profile, subject to its privacy settings', access: 'any', params: idParam,
    handler: async ({ user, params }) => {
      const base = await one(`SELECT u.id, u.role, u.status FROM users u WHERE u.id = $1`, [params.id]);
      if (!base || base.role === 'admin' || (base.status !== 'active' && user.role !== 'admin')) throw notFound('Profile');
      if (user.id !== params.id && user.role !== 'admin' && await isBlockedBetween(user.id, params.id)) throw notFound('Profile');
      const connection = await one(`SELECT id, status, requester_id FROM connections WHERE status <> 'rejected'
        AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`, [user.id, params.id]);
      if (base.role === 'teacher') {
        const { email: _e, ...t } = await teacherProfile(params.id);
        const pending = t.verificationStatus !== 'approved';
        if (pending && user.role !== 'admin' && user.id !== params.id) throw notFound('Profile');
        return { ...t, connection: connection ?? null };
      }
      const profile = await studentProfile(params.id);
      const { email: _email, ...full } = profile;
      const privileged = user.id === params.id || user.role === 'admin' || connection?.status === 'accepted';
      if (privileged || full.visibility === 'everyone') return { ...full, limited: false, connection: connection ?? null };
      if (full.visibility === 'hidden') throw notFound('Profile');
      return { id: full.id, fullName: full.fullName, avatarFileId: full.avatarFileId, role: 'student', limited: true, connection: connection ?? null };
    },
  });

  route(router, {
    tag: 'Discovery', method: 'get', path: '/api/students', summary: 'Search and filter students', access: COLLABORATORS,
    query: pageQuery.extend({ q: text(80).default(''), subjects: csv, skills: csv, interests: csv, year: z.coerce.number().int().min(1).max(8).optional(), availability: csv }),
    handler: async ({ user, query }) => {
      const params: unknown[] = [user.id];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const where = [`u.id <> $1`, `u.status = 'active'`, `u.email_verified_at IS NOT NULL`, NOT_BLOCKED,
        `(p.visibility = 'everyone' OR (p.visibility = 'connections' AND EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND LEAST(c.requester_id, c.addressee_id) = LEAST(u.id, $1::uuid) AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(u.id, $1::uuid))))`];
      if (query.q) where.push(`lower(u.full_name) LIKE lower(${add(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`)})`);
      for (const [field, kind] of [['subjects', 'subject'], ['skills', 'skill'], ['interests', 'interest']] as const) {
        if (query[field].length) {
          where.push(`EXISTS (SELECT 1 FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = u.id AND t.kind = '${kind}' AND lower(t.name) = ANY(${add(query[field].map((s) => s.toLowerCase()))}))`);
        }
      }
      if (query.year) where.push(`p.academic_year = ${add(query.year)}`);
      if (query.availability.length) where.push(`p.availability && ${add(query.availability)}`);
      const rows = await q(`SELECT u.id, u.full_name, u.avatar_file_id, p.institution, p.department, p.academic_year, ${TOPICS}, ${CONNECTION_STATE}, count(*) OVER()::int AS total_count
          FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE ${where.join(' AND ')}
          ORDER BY u.full_name, u.id LIMIT ${add(query.pageSize)} OFFSET ${add(offset(query))}`, params);
      return paged(rows, query);
    },
  });

  route(router, {
    tag: 'Discovery', method: 'get', path: '/api/matches', summary: 'Recommended study partners with explanations', access: ['student'],
    query: z.object({ limit: z.coerce.number().int().min(1).max(30).default(12) }),
    handler: async ({ user, query }) => ({ items: await recommendPartners(user.id, query.limit), method: 'weighted_rules' }),
  });

  route(router, {
    tag: 'Discovery', method: 'get', path: '/api/teachers', summary: 'Browse verified teachers', access: COLLABORATORS,
    query: pageQuery.extend({ q: text(80).default(''), subject: text(80).default('') }),
    handler: async ({ query, user }) => {
      const rows = await q(`SELECT u.id, u.full_name, u.avatar_file_id, p.institution, p.department, p.designation, p.bio, ${TOPICS},
          (SELECT m.status FROM mentorships m WHERE m.teacher_id = u.id AND m.student_id = $1 AND m.status IN ('pending', 'accepted') LIMIT 1) AS mentorship_status,
          count(*) OVER()::int AS total_count
          FROM users u JOIN teacher_profiles p ON p.user_id = u.id
         WHERE p.verification_status = 'approved' AND u.status = 'active' AND lower(u.full_name) LIKE lower($2)
           AND ($3 = '' OR EXISTS (SELECT 1 FROM user_topics ut JOIN topics t ON t.id = ut.topic_id WHERE ut.user_id = u.id AND lower(t.name) = lower($3)))
         ORDER BY u.full_name LIMIT $4 OFFSET $5`, [user.id, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`, query.subject, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  const ctag = 'Connections';

  route(router, {
    tag: ctag, method: 'get', path: '/api/connections', summary: 'My connections and pending requests', access: COLLABORATORS,
    handler: async ({ user }) => {
      const rows = await q(`SELECT c.id, c.status, c.requester_id, c.created_at, o.id AS other_id, o.full_name AS other_name, o.avatar_file_id AS other_avatar, o.role AS other_role
          FROM connections c JOIN users o ON o.id = CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END
         WHERE (c.requester_id = $1 OR c.addressee_id = $1) AND c.status <> 'rejected' AND o.status = 'active' ORDER BY o.full_name`, [user.id]);
      return {
        connections: rows.filter((r) => r.status === 'accepted'),
        incoming: rows.filter((r) => r.status === 'pending' && r.requesterId !== user.id),
        outgoing: rows.filter((r) => r.status === 'pending' && r.requesterId === user.id),
      };
    },
  });

  route(router, {
    tag: ctag, method: 'post', path: '/api/connections', summary: 'Send a connection request', access: COLLABORATORS,
    body: z.object({ userId: z.uuid() }),
    handler: async ({ user, body }) => {
      if (body.userId === user.id) throw badRequest('You cannot connect with yourself.');
      const other = await one(`SELECT id, role FROM users WHERE id = $1 AND status = 'active' AND role <> 'admin'`, [body.userId]);
      if (!other || await isBlockedBetween(user.id, body.userId)) throw notFound('User');
      const row = await tx(async () => {
        const existing = await one(`SELECT id, status FROM connections WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid) FOR UPDATE`, [user.id, body.userId]);
        if (existing && existing.status !== 'rejected') throw conflict('A connection or request already exists.');
        if (existing) return one(`UPDATE connections SET requester_id = $1, addressee_id = $2, status = 'pending', created_at = now(), responded_at = NULL WHERE id = $3 RETURNING id, status`, [user.id, body.userId, existing.id]);
        return one('INSERT INTO connections (requester_id, addressee_id) VALUES ($1, $2) RETURNING id, status', [user.id, body.userId]);
      });
      await notify(body.userId, 'connection_request', { title: `${user.fullName} wants to connect`, link: '/app/connections' });
      return row;
    },
  });

  route(router, {
    tag: ctag, method: 'patch', path: '/api/connections/:id', summary: 'Accept or reject a request', access: COLLABORATORS, params: idParam,
    body: z.object({ action: z.enum(['accept', 'reject']) }),
    handler: async ({ user, params, body }) => {
      const row = await one(`UPDATE connections SET status = $1, responded_at = now() WHERE id = $2 AND addressee_id = $3 AND status = 'pending' RETURNING requester_id, status`,
        [body.action === 'accept' ? 'accepted' : 'rejected', params.id, user.id]);
      if (!row) throw notFound('Request');
      if (body.action === 'accept') await notify(row.requesterId, 'connection_accepted', { title: `${user.fullName} accepted your request`, link: '/app/connections' });
      return { status: row.status };
    },
  });

  route(router, {
    tag: ctag, method: 'delete', path: '/api/connections/:id', summary: 'Remove a connection or cancel a request', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      const row = await one('DELETE FROM connections WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2) RETURNING id', [params.id, user.id]);
      if (!row) throw notFound('Connection');
      return { ok: true };
    },
  });

  route(router, {
    tag: ctag, method: 'post', path: '/api/blocks/:id', summary: 'Block a user', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      if (params.id === user.id) throw badRequest('You cannot block yourself.');
      await tx(async () => {
        await q('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, params.id]);
        await q(`DELETE FROM connections WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`, [user.id, params.id]);
      });
      return { ok: true };
    },
  });

  route(router, {
    tag: ctag, method: 'get', path: '/api/blocks', summary: 'Users I have blocked', access: COLLABORATORS,
    handler: async ({ user }) => ({ items: await q('SELECT u.id, u.full_name FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY u.full_name', [user.id]) }),
  });

  route(router, {
    tag: ctag, method: 'delete', path: '/api/blocks/:id', summary: 'Unblock a user', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => { await q('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [user.id, params.id]); return { ok: true }; },
  });

  route(router, {
    tag: 'Resources', method: 'get', path: '/api/files/:id', summary: 'Download a file the signed-in user may access', access: 'any', params: idParam, raw: true,
    handler: async ({ user, params, res }) => {
      const file = await canAccessFile(user, params.id);
      const data = await storage.get(file.storageKey);
      const inline = file.purpose === 'avatar' && file.mimeType.startsWith('image/');
      res.set({
        'Content-Type': file.mimeType,
        'Content-Length': String(data.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        // Private so a shared cache cannot serve one user's file to another.
        'Cache-Control': 'private, max-age=300',
      });
      res.end(data);
    },
  });
}
