// Projects, messaging, study sessions and learning resources.
import type { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/core.js';
import { COLLABORATORS, csv, idParam, isoDate, offset, paged, pageQuery, required, route, text, type AuthUser } from '../lib/route.js';
import { notify, notifyMany, pushToUser, saveUpload } from '../lib/services.js';
import { createTask, memberIds, memberRole, recordActivity, requireMember, taskBody } from './groups.js';
import { areConnected, isBlockedBetween, topicIds } from './people.js';
import { canCheckIn, canManageGroup, canModifyProject, projectProgress, sessionIcs } from './rules.js';

// Projects ------------------------------------------------------------------

async function loadProject(id: string, userId: string) {
  const project = await one(`SELECT p.*, g.name AS group_name FROM projects p JOIN study_groups g ON g.id = p.group_id WHERE p.id = $1 AND g.deleted_at IS NULL`, [id]);
  if (!project) throw notFound('Project');
  const groupRole = await memberRole(project.groupId, userId);
  if (!groupRole) throw notFound('Project');
  const isMember = !!(await one('SELECT 1 AS x FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId]));
  return { project, groupRole, isMember, canModify: canModifyProject(groupRole, isMember) };
}

async function requireProjectEditor(id: string, userId: string) {
  const loaded = await loadProject(id, userId);
  if (!loaded.canModify) throw forbidden('Only members of this project can change it.');
  return loaded;
}

function projectRoutes(router: Router) {
  const tag = 'Projects';

  route(router, {
    tag, method: 'get', path: '/api/projects', summary: 'Projects in my groups', access: COLLABORATORS,
    query: pageQuery.extend({ status: z.enum(['active', 'completed', 'archived']).optional(), groupId: z.uuid().optional() }),
    handler: async ({ user, query }) => {
      const rows = await q(`SELECT p.id, p.title, p.description, p.status, p.group_id, g.name AS group_name, p.created_at,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_count,
          (SELECT count(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count, count(*) OVER()::int AS total_count
        FROM projects p JOIN study_groups g ON g.id = p.group_id AND g.deleted_at IS NULL
        JOIN group_members m ON m.group_id = p.group_id AND m.user_id = $1
        WHERE ($2::text IS NULL OR p.status = $2) AND ($3::uuid IS NULL OR p.group_id = $3)
        ORDER BY p.created_at DESC LIMIT $4 OFFSET $5`, [user.id, query.status ?? null, query.groupId ?? null, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/projects', summary: 'Create a project within a group', access: COLLABORATORS,
    body: z.object({ groupId: z.uuid(), title: required(160), description: text(4000).default(''), objectives: text(4000).default(''), memberIds: z.array(z.uuid()).max(50).default([]) }),
    handler: async ({ user, body }) => {
      await requireMember(body.groupId, user.id);
      const members = [...new Set([user.id, ...body.memberIds])];
      for (const id of members) if (!(await memberRole(body.groupId, id))) throw badRequest('Project members must belong to the group.');
      return tx(async () => {
        const project = (await one(`INSERT INTO projects (group_id, created_by, title, description, objectives) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [body.groupId, user.id, body.title, body.description, body.objectives]))!;
        await q('INSERT INTO project_members (project_id, user_id) SELECT $1, unnest($2::uuid[])', [project.id, members]);
        const convo = (await one(`INSERT INTO conversations (type, project_id) VALUES ('project', $1) RETURNING id`, [project.id]))!;
        await q('INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[])', [convo.id, members]);
        await recordActivity(body.groupId, user.id, 'created a project', body.title);
        return project;
      });
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/projects/:id', summary: 'Project with tasks, milestones and members', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      const { project, groupRole, isMember, canModify } = await loadProject(params.id, user.id);
      const [tasks, milestones, members, groupMembers, resources, conversation] = await Promise.all([
        q(`SELECT t.*, u.full_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = $1 ORDER BY t.due_at NULLS LAST, t.created_at`, [params.id]),
        q('SELECT * FROM milestones WHERE project_id = $1 ORDER BY due_at NULLS LAST, created_at', [params.id]),
        q('SELECT u.id, u.full_name, u.avatar_file_id FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY u.full_name', [params.id]),
        q('SELECT u.id, u.full_name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY u.full_name', [project.groupId]),
        q(`SELECT r.id, r.title, r.kind, r.url, r.file_id FROM resources r WHERE r.project_id = $1 ORDER BY r.created_at DESC`, [params.id]),
        one(`SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2 WHERE c.project_id = $1`, [params.id, user.id]),
      ]);
      return { ...project, groupRole, isMember, canModify, tasks, milestones, members, groupMembers, resources, progress: projectProgress(tasks), conversationId: conversation?.id ?? null };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/projects/:id', summary: 'Update a project', access: COLLABORATORS, params: idParam,
    body: z.object({ title: required(160), description: text(4000), objectives: text(4000), status: z.enum(['active', 'completed', 'archived']), memberIds: z.array(z.uuid()).max(50) }).partial(),
    handler: async ({ user, params, body }) => {
      const { project } = await requireProjectEditor(params.id, user.id);
      await tx(async () => {
        await q(`UPDATE projects SET title = COALESCE($2, title), description = COALESCE($3, description), objectives = COALESCE($4, objectives), status = COALESCE($5, status), updated_at = now() WHERE id = $1`,
          [params.id, body.title ?? null, body.description ?? null, body.objectives ?? null, body.status ?? null]);
        if (body.memberIds) {
          for (const id of body.memberIds) if (!(await memberRole(project.groupId, id))) throw badRequest('Project members must belong to the group.');
          if (!body.memberIds.length) throw badRequest('A project needs at least one member.');
          const convo = await one(`SELECT id FROM conversations WHERE project_id = $1`, [params.id]);
          await q('DELETE FROM project_members WHERE project_id = $1', [params.id]);
          await q('INSERT INTO project_members (project_id, user_id) SELECT $1, unnest($2::uuid[])', [params.id, body.memberIds]);
          await q('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id <> ALL($2::uuid[])', [convo.id, body.memberIds]);
          await q('INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [convo.id, body.memberIds]);
        }
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/projects/:id/tasks', summary: 'Add a task to a project', access: COLLABORATORS, params: idParam, body: taskBody(),
    handler: async ({ user, params, body }) => {
      const { project } = await requireProjectEditor(params.id, user.id);
      return createTask(user, project.groupId, params.id, body);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/projects/:id/milestones', summary: 'Add a milestone', access: COLLABORATORS, params: idParam,
    body: z.object({ title: required(160), dueAt: isoDate.nullable().optional() }),
    handler: async ({ user, params, body }) => {
      await requireProjectEditor(params.id, user.id);
      return one('INSERT INTO milestones (project_id, title, due_at) VALUES ($1, $2, $3) RETURNING *', [params.id, body.title, body.dueAt ?? null]);
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/milestones/:id', summary: 'Complete or reopen a milestone', access: COLLABORATORS, params: idParam,
    body: z.object({ completed: z.boolean() }),
    handler: async ({ user, params, body }) => {
      const milestone = await one('SELECT * FROM milestones WHERE id = $1', [params.id]);
      if (!milestone) throw notFound('Milestone');
      const { project } = await requireProjectEditor(milestone.projectId, user.id);
      const updated = await one(`UPDATE milestones SET completed_at = CASE WHEN $2 THEN COALESCE(completed_at, now()) ELSE NULL END WHERE id = $1 RETURNING *`, [params.id, body.completed]);
      if (body.completed) await recordActivity(project.groupId, user.id, 'completed a milestone', milestone.title);
      return updated;
    },
  });
}

// Messaging -----------------------------------------------------------------

async function requireConversation(id: string, userId: string) {
  const c = await one(`SELECT c.* FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id WHERE c.id = $1 AND cm.user_id = $2`, [id, userId]);
  // A conversation you are not in looks the same as one that does not exist.
  if (!c) throw notFound('Conversation');
  return c;
}

const MESSAGE_FIELDS = `m.id, m.conversation_id, m.sender_id, u.full_name AS sender_name, m.body, m.created_at, m.file_id, f.original_name AS file_name, f.size_bytes AS file_size`;
const MESSAGE_JOINS = 'FROM messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN files f ON f.id = m.file_id';

async function postMessage(user: AuthUser, conversationId: string, body: string, fileId: string | null) {
  const conversation = await requireConversation(conversationId, user.id);
  const others = (await q('SELECT user_id, last_read_at FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2', [conversationId, user.id]));
  if (conversation.type === 'direct' && others[0] && await isBlockedBetween(user.id, others[0].userId)) throw forbidden('You cannot message this person.');
  // Only the first unread message in a conversation generates a notification.
  const quiet = new Set((await q(`SELECT DISTINCT cm.user_id FROM conversation_members cm JOIN messages m ON m.conversation_id = cm.conversation_id AND m.created_at > cm.last_read_at AND m.sender_id <> cm.user_id WHERE cm.conversation_id = $1`, [conversationId])).map((r) => r.userId));
  const created = (await one('INSERT INTO messages (conversation_id, sender_id, body, file_id) VALUES ($1, $2, $3, $4) RETURNING id', [conversationId, user.id, body, fileId]))!;
  await q('UPDATE conversations SET last_message_at = now() WHERE id = $1', [conversationId]);
  await q('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [conversationId, user.id]);
  const message = await one(`SELECT ${MESSAGE_FIELDS} ${MESSAGE_JOINS} WHERE m.id = $1`, [created.id]);
  for (const other of others) {
    pushToUser(other.userId, { type: 'message', message });
    if (!quiet.has(other.userId)) await notify(other.userId, 'message', { title: `New message from ${user.fullName}`, body: body.slice(0, 120), link: `/app/messages/${conversationId}` });
  }
  pushToUser(user.id, { type: 'message', message });
  return message;
}

function messagingRoutes(router: Router) {
  const tag = 'Messaging';

  route(router, {
    tag, method: 'get', path: '/api/conversations', summary: 'My conversations with unread counts', access: COLLABORATORS,
    handler: async ({ user }) => ({
      items: await q(`SELECT c.id, c.type, c.group_id, c.project_id, c.last_message_at,
          CASE c.type WHEN 'group' THEN g.name WHEN 'project' THEN p.title ELSE other.full_name END AS title,
          other.id AS other_user_id, other.avatar_file_id AS other_avatar,
          (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.created_at > me.last_read_at AND m.sender_id IS DISTINCT FROM $1) AS unread_count,
          (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
        FROM conversation_members me JOIN conversations c ON c.id = me.conversation_id
        LEFT JOIN study_groups g ON g.id = c.group_id LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN LATERAL (SELECT u.id, u.full_name, u.avatar_file_id FROM conversation_members o JOIN users u ON u.id = o.user_id WHERE c.type = 'direct' AND o.conversation_id = c.id AND o.user_id <> $1 LIMIT 1) other ON true
        WHERE me.user_id = $1 AND g.deleted_at IS NULL ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`, [user.id]),
    }),
  });

  route(router, {
    tag, method: 'post', path: '/api/conversations', summary: 'Start or open a one-to-one conversation', access: COLLABORATORS,
    body: z.object({ userId: z.uuid() }),
    handler: async ({ user, body }) => {
      if (body.userId === user.id) throw badRequest('You cannot message yourself.');
      if (await isBlockedBetween(user.id, body.userId)) throw forbidden('You cannot message this person.');
      const mentoring = await one(`SELECT 1 AS x FROM mentorships WHERE status = 'accepted' AND ((student_id = $1 AND teacher_id = $2) OR (student_id = $2 AND teacher_id = $1))`, [user.id, body.userId]);
      if (!mentoring && !(await areConnected(user.id, body.userId))) throw forbidden('You can only message your connections and mentors.');
      const key = [user.id, body.userId].sort().join(':');
      return tx(async () => {
        const conversation = (await one(`INSERT INTO conversations (type, direct_key) VALUES ('direct', $1) ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key RETURNING id`, [key]))!;
        await q('INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [conversation.id, [user.id, body.userId]]);
        return conversation;
      });
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/conversations/:id/messages', summary: 'Message history, newest page first', access: COLLABORATORS, params: idParam,
    query: z.object({ before: isoDate.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }),
    handler: async ({ user, params, query }) => {
      await requireConversation(params.id, user.id);
      const rows = await q(`SELECT ${MESSAGE_FIELDS} ${MESSAGE_JOINS} WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2) ORDER BY m.created_at DESC LIMIT $3`, [params.id, query.before ?? null, query.limit]);
      return { items: rows.reverse(), hasMore: rows.length === query.limit };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/conversations/:id/messages', summary: 'Send a message, optionally with one file', access: COLLABORATORS, params: idParam, upload: 'file',
    body: z.object({ body: text(4000).default('') }),
    handler: async ({ user, params, body, file }) => {
      await requireConversation(params.id, user.id);
      if (!body.body && !file) throw badRequest('Write a message or attach a file.');
      const saved = file ? await saveUpload(user.id, file, 'message') : null;
      return postMessage(user, params.id, body.body, saved?.id ?? null);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/conversations/:id/read', summary: 'Mark a conversation as read', access: COLLABORATORS, params: idParam, status: 200,
    handler: async ({ user, params }) => {
      await requireConversation(params.id, user.id);
      await q('UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [params.id, user.id]);
      return { ok: true };
    },
  });
}

// Study sessions ------------------------------------------------------------

async function loadSessionFor(id: string, userId: string) {
  const session = await one('SELECT * FROM study_sessions WHERE id = $1', [id]);
  if (!session) throw notFound('Session');
  const participant = await one('SELECT attended_at FROM session_participants WHERE session_id = $1 AND user_id = $2', [id, userId]);
  const inGroup = session.groupId ? !!(await memberRole(session.groupId, userId)) : false;
  if (!participant && !inGroup && session.organizerId !== userId) throw notFound('Session');
  return { session, participant, inGroup };
}

function sessionRoutes(router: Router) {
  const tag = 'Study Sessions';
  const SESSION_FIELDS = `s.id, s.title, s.description, s.starts_at, s.duration_minutes, s.status, s.group_id, s.mentorship_id, s.organizer_id, g.name AS group_name, o.full_name AS organizer_name,
    (SELECT count(*)::int FROM session_participants p WHERE p.session_id = s.id) AS participant_count,
    EXISTS (SELECT 1 FROM session_participants p WHERE p.session_id = s.id AND p.user_id = $1) AS joined,
    (SELECT p.attended_at FROM session_participants p WHERE p.session_id = s.id AND p.user_id = $1) AS attended_at`;

  route(router, {
    tag, method: 'get', path: '/api/sessions', summary: 'Sessions I organize, joined, or can join through a group', access: COLLABORATORS,
    query: pageQuery.extend({ scope: z.enum(['upcoming', 'past']).default('upcoming') }),
    handler: async ({ user, query }) => {
      const upcoming = query.scope === 'upcoming';
      const rows = await q(`SELECT ${SESSION_FIELDS}, count(*) OVER()::int AS total_count FROM study_sessions s
          JOIN users o ON o.id = s.organizer_id LEFT JOIN study_groups g ON g.id = s.group_id
        WHERE (s.organizer_id = $1 OR EXISTS (SELECT 1 FROM session_participants p WHERE p.session_id = s.id AND p.user_id = $1)
               OR EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = s.group_id AND m.user_id = $1))
          AND ${upcoming ? `s.starts_at + make_interval(mins => s.duration_minutes) >= now()` : `s.starts_at + make_interval(mins => s.duration_minutes) < now()`}
        ORDER BY s.starts_at ${upcoming ? 'ASC' : 'DESC'} LIMIT $2 OFFSET $3`, [user.id, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/sessions', summary: 'Schedule a study or mentorship session', access: COLLABORATORS,
    body: z.object({
      title: required(160), description: text(2000).default(''), startsAt: isoDate, durationMinutes: z.number().int().min(5).max(600),
      groupId: z.uuid().nullable().optional(), mentorshipId: z.uuid().nullable().optional(),
    }).refine((b) => !(b.groupId && b.mentorshipId), 'Choose either a group or a mentorship.'),
    handler: async ({ user, body }) => {
      if (new Date(body.startsAt).getTime() < Date.now() - 60000) throw badRequest('Sessions must be scheduled in the future.');
      const participants = new Set([user.id]);
      let notifyIds: string[] = [];
      if (body.groupId) {
        await requireMember(body.groupId, user.id);
        notifyIds = await memberIds(body.groupId, user.id);
      }
      if (body.mentorshipId) {
        const m = await one(`SELECT student_id, teacher_id FROM mentorships WHERE id = $1 AND status = 'accepted' AND (student_id = $2 OR teacher_id = $2)`, [body.mentorshipId, user.id]);
        if (!m) throw forbidden('You are not part of an active mentorship with that ID.');
        participants.add(m.studentId).add(m.teacherId);
        notifyIds = [...participants].filter((id) => id !== user.id);
      }
      const created = await tx(async () => {
        const session = (await one(`INSERT INTO study_sessions (organizer_id, group_id, mentorship_id, title, description, starts_at, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [user.id, body.groupId ?? null, body.mentorshipId ?? null, body.title, body.description, body.startsAt, body.durationMinutes]))!;
        await q('INSERT INTO session_participants (session_id, user_id) SELECT $1, unnest($2::uuid[])', [session.id, [...participants]]);
        if (body.groupId) await recordActivity(body.groupId, user.id, 'scheduled a session', body.title);
        return session;
      });
      await notifyMany(notifyIds, 'session_reminder', { title: `New session: ${body.title}`, body: `Starts ${new Date(body.startsAt).toUTCString()}`, link: '/app/sessions' });
      return created;
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/sessions/:id', summary: 'Reschedule, edit or cancel a session (organizer only)', access: COLLABORATORS, params: idParam,
    body: z.object({ title: required(160), description: text(2000), startsAt: isoDate, durationMinutes: z.number().int().min(5).max(600), status: z.enum(['scheduled', 'cancelled']) }).partial(),
    handler: async ({ user, params, body }) => {
      const { session } = await loadSessionFor(params.id, user.id);
      if (session.organizerId !== user.id) throw forbidden('Only the organizer can change this session.');
      if (body.startsAt && new Date(body.startsAt).getTime() < Date.now() - 60000) throw badRequest('Sessions must be scheduled in the future.');
      await q(`UPDATE study_sessions SET title = COALESCE($2, title), description = COALESCE($3, description), starts_at = COALESCE($4, starts_at), duration_minutes = COALESCE($5, duration_minutes),
          status = COALESCE($6, status), reminded_at = CASE WHEN $4::timestamptz IS NULL THEN reminded_at ELSE NULL END, updated_at = now() WHERE id = $1`,
        [params.id, body.title ?? null, body.description ?? null, body.startsAt ?? null, body.durationMinutes ?? null, body.status ?? null]);
      const ids = (await q('SELECT user_id FROM session_participants WHERE session_id = $1 AND user_id <> $2', [params.id, user.id])).map((r) => r.userId);
      const title = body.status === 'cancelled' ? `Session cancelled: ${session.title}` : `Session updated: ${body.title ?? session.title}`;
      await notifyMany(ids, 'session_reminder', { title, link: '/app/sessions' });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/sessions/:id/join', summary: 'Join a session', access: COLLABORATORS, params: idParam, status: 200,
    handler: async ({ user, params }) => {
      const { session } = await loadSessionFor(params.id, user.id);
      if (session.status === 'cancelled') throw badRequest('This session was cancelled.');
      await q('INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [params.id, user.id]);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/sessions/:id/leave', summary: 'Leave a session', access: COLLABORATORS, params: idParam, status: 200,
    handler: async ({ user, params }) => {
      const { session } = await loadSessionFor(params.id, user.id);
      if (session.organizerId === user.id) throw badRequest('Organizers can cancel the session instead.');
      await q('DELETE FROM session_participants WHERE session_id = $1 AND user_id = $2', [params.id, user.id]);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/sessions/:id/check-in', summary: 'Record my attendance while a session is running', access: COLLABORATORS, params: idParam, status: 200,
    handler: async ({ user, params }) => {
      const { session, participant } = await loadSessionFor(params.id, user.id);
      if (!participant) throw badRequest('Join the session first.');
      if (session.status === 'cancelled' || !canCheckIn(new Date(session.startsAt), session.durationMinutes)) throw badRequest('Check-in opens 15 minutes before the session and closes when it ends.');
      await q('UPDATE session_participants SET attended_at = COALESCE(attended_at, now()) WHERE session_id = $1 AND user_id = $2', [params.id, user.id]);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/sessions/:id/calendar.ics', summary: 'Download a session as a calendar file', access: COLLABORATORS, params: idParam, raw: true,
    handler: async ({ user, params, res }) => {
      const { session } = await loadSessionFor(params.id, user.id);
      res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="study-session.ics"' });
      res.send(sessionIcs(session));
    },
  });
}

// Learning resources --------------------------------------------------------

const httpUrl = z.url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Links must start with http:// or https://.');

function resourceRoutes(router: Router) {
  const tag = 'Resources';

  route(router, {
    tag, method: 'get', path: '/api/resources', summary: 'Search resources I can access', access: COLLABORATORS,
    query: pageQuery.extend({ q: text(80).default(''), subject: text(80).default(''), tags: csv, groupId: z.uuid().optional() }),
    handler: async ({ user, query }) => {
      const rows = await q(`SELECT r.id, r.title, r.description, r.kind, r.url, r.file_id, r.tags, r.group_id, r.owner_id, r.created_at, u.full_name AS owner_name, t.name AS subject, g.name AS group_name, f.original_name AS file_name, f.size_bytes AS file_size, count(*) OVER()::int AS total_count
        FROM resources r JOIN users u ON u.id = r.owner_id LEFT JOIN topics t ON t.id = r.subject_id LEFT JOIN study_groups g ON g.id = r.group_id LEFT JOIN files f ON f.id = r.file_id
        WHERE (r.group_id IS NULL OR (g.deleted_at IS NULL AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = r.group_id AND m.user_id = $1)))
          AND ($2 = '' OR lower(r.title) LIKE lower($2) OR lower(r.description) LIKE lower($2))
          AND ($3 = '' OR lower(t.name) = lower($3)) AND (cardinality($4::text[]) = 0 OR r.tags && $4) AND ($5::uuid IS NULL OR r.group_id = $5)
        ORDER BY r.created_at DESC LIMIT $6 OFFSET $7`,
      [user.id, query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : '', query.subject, query.tags.map((t) => t.toLowerCase()), query.groupId ?? null, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/resources', summary: 'Share a file or link', access: COLLABORATORS, upload: 'file',
    body: z.object({
      title: required(160), description: text(2000).default(''), url: z.preprocess((v) => (v === '' ? undefined : v), httpUrl.optional()), subject: text(80).default(''), tags: csv,
      groupId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()), projectId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
    }),
    handler: async ({ user, body, file }) => {
      if (!!file === !!body.url) throw badRequest('Provide either a file or a link.');
      let groupId = body.groupId ?? null;
      if (body.projectId) {
        const { project, canModify } = await loadProject(body.projectId, user.id);
        if (!canModify) throw forbidden('Only members of this project can add documents.');
        groupId = project.groupId;
      } else if (groupId) await requireMember(groupId, user.id);
      const saved = file ? await saveUpload(user.id, file, 'resource') : null;
      const subjectId = body.subject ? (await topicIds('subject', [body.subject]))[0] : null;
      const resource = await one(`INSERT INTO resources (owner_id, group_id, project_id, subject_id, title, description, kind, url, file_id, tags) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [user.id, groupId, body.projectId ?? null, subjectId, body.title, body.description, saved ? 'file' : 'link', body.url ?? null, saved?.id ?? null, body.tags.map((t) => t.toLowerCase())]);
      if (groupId) await recordActivity(groupId, user.id, 'shared a resource', body.title);
      return resource;
    },
  });

  route(router, {
    tag, method: 'delete', path: '/api/resources/:id', summary: 'Delete a resource', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      const resource = await one('SELECT owner_id, group_id FROM resources WHERE id = $1', [params.id]);
      if (!resource) throw notFound('Resource');
      const manager = resource.groupId ? canManageGroup(await memberRole(resource.groupId, user.id)) : false;
      if (resource.ownerId !== user.id && !manager) throw forbidden();
      await q('DELETE FROM resources WHERE id = $1', [params.id]);
      return { ok: true };
    },
  });
}

export function collaborationRoutes(router: Router) {
  projectRoutes(router);
  messagingRoutes(router);
  sessionRoutes(router);
  resourceRoutes(router);
}
