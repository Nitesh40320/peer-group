// Study groups, membership and the shared workspace (announcements, tasks, activity).
import type { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/core.js';
import { COLLABORATORS, csv, idParam, isoDate, offset, paged, pageQuery, required, route, text, topicList, type AuthUser } from '../lib/route.js';
import { notify, notifyMany } from '../lib/services.js';
import { isBlockedBetween, topicIds } from './people.js';
import { canChangeMemberRole, canManageGroup, canRemoveMember, hasCapacity, TASK_STATUSES, type GroupRole } from './rules.js';

const tag = 'Study Groups';

const GROUP_FIELDS = `g.id, g.owner_id, g.name, g.description, g.objectives, g.difficulty, g.capacity, g.visibility, g.kind, g.created_at, o.full_name AS owner_name,
  (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count,
  COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM group_topics gt JOIN topics t ON t.id = gt.topic_id WHERE gt.group_id = g.id), '{}') AS topics,
  (SELECT m.role FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS my_role,
  EXISTS (SELECT 1 FROM group_join_requests r WHERE r.group_id = g.id AND r.user_id = $1 AND r.status = 'pending') AS has_pending_request,
  (SELECT i.id FROM group_invitations i WHERE i.group_id = g.id AND i.invitee_id = $1 AND i.status = 'pending' LIMIT 1) AS pending_invitation_id`;

async function getGroup(groupId: string, userId: string) {
  const group = await one(`SELECT ${GROUP_FIELDS} FROM study_groups g JOIN users o ON o.id = g.owner_id WHERE g.id = $2 AND g.deleted_at IS NULL`, [userId, groupId]);
  if (!group) throw notFound('Group');
  // A private group is indistinguishable from a missing one unless you belong or were invited.
  if (group.visibility === 'private' && !group.myRole && !group.pendingInvitationId) throw notFound('Group');
  return group;
}

export async function memberRole(groupId: string, userId: string): Promise<GroupRole | null> {
  const row = await one(`SELECT m.role FROM group_members m JOIN study_groups g ON g.id = m.group_id WHERE m.group_id = $1 AND m.user_id = $2 AND g.deleted_at IS NULL`, [groupId, userId]);
  return row?.role ?? null;
}

export async function requireMember(groupId: string, userId: string) {
  const role = await memberRole(groupId, userId);
  if (!role) throw forbidden('Only members of this group can do that.');
  return role;
}

async function requireManager(groupId: string, userId: string) {
  const role = await requireMember(groupId, userId);
  if (!canManageGroup(role)) throw forbidden('Only group owners and leaders can do that.');
  return role;
}

export async function recordActivity(groupId: string, actorId: string | null, verb: string, detail = '') {
  await q('INSERT INTO group_activity (group_id, actor_id, verb, detail) VALUES ($1, $2, $3, $4)', [groupId, actorId, verb, detail]);
}

export const memberIds = async (groupId: string, exclude?: string) =>
  (await q('SELECT user_id FROM group_members WHERE group_id = $1 AND ($2::uuid IS NULL OR user_id <> $2)', [groupId, exclude ?? null])).map((r) => r.userId as string);

/** Adds a member under a row lock, so two approvals cannot exceed capacity. */
async function addMember(groupId: string, userId: string, role: GroupRole = 'member') {
  await tx(async () => {
    const group = await one('SELECT capacity FROM study_groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [groupId]);
    if (!group) throw notFound('Group');
    const { count } = (await one('SELECT count(*)::int AS count FROM group_members WHERE group_id = $1', [groupId]))!;
    if (!hasCapacity(count, group.capacity)) throw conflict('This group is full.', 'GROUP_FULL');
    await q('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [groupId, userId, role]);
    await q(`INSERT INTO conversation_members (conversation_id, user_id)
      SELECT id, $2 FROM conversations WHERE type = 'group' AND group_id = $1 ON CONFLICT DO NOTHING`, [groupId, userId]);
  });
}

async function removeMember(groupId: string, userId: string) {
  await tx(async () => {
    await q('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    await q(`DELETE FROM conversation_members WHERE user_id = $2 AND conversation_id IN
      (SELECT c.id FROM conversations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.group_id = $1 OR p.group_id = $1)`, [groupId, userId]);
    await q('DELETE FROM project_members WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE group_id = $1)', [groupId, userId]);
    await q(`UPDATE tasks SET assignee_id = NULL WHERE group_id = $1 AND assignee_id = $2 AND status <> 'completed'`, [groupId, userId]);
  });
}

const groupBody = z.object({
  name: required(120),
  description: text(2000).default(''),
  objectives: text(2000).default(''),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  capacity: z.coerce.number().int().min(2).max(200).default(10),
  visibility: z.enum(['public', 'private']).default('public'),
  kind: z.enum(['study', 'community']).default('study'),
  subjects: topicList.default([]),
});

async function setGroupTopics(groupId: string, subjects: string[]) {
  const ids = await topicIds('subject', subjects);
  await q('DELETE FROM group_topics WHERE group_id = $1', [groupId]);
  if (ids.length) await q('INSERT INTO group_topics (group_id, topic_id) SELECT $1, unnest($2::uuid[])', [groupId, ids]);
}

async function createGroup(user: AuthUser, body: z.output<typeof groupBody>) {
  if (body.kind === 'community' && user.role !== 'teacher') throw forbidden('Only approved teachers can create academic communities.');
  return tx(async () => {
    const group = (await one(
      `INSERT INTO study_groups (owner_id, name, description, objectives, difficulty, capacity, visibility, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [user.id, body.name, body.description, body.objectives, body.difficulty, body.capacity, body.visibility, body.kind]))!;
    await setGroupTopics(group.id, body.subjects);
    await q(`INSERT INTO conversations (type, group_id) VALUES ('group', $1)`, [group.id]);
    await addMember(group.id, user.id, 'owner');
    await recordActivity(group.id, user.id, 'created the group');
    return group as { id: string };
  });
}

/** Groups with subjects the student studies that they have not joined. */
export async function recommendGroups(userId: string, limit: number) {
  return q(`SELECT ${GROUP_FIELDS},
      (SELECT count(*)::int FROM group_topics gt JOIN user_topics ut ON ut.topic_id = gt.topic_id WHERE gt.group_id = g.id AND ut.user_id = $1) AS shared_topics
      FROM study_groups g JOIN users o ON o.id = g.owner_id
     WHERE g.deleted_at IS NULL AND g.visibility = 'public'
       AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1)
       AND EXISTS (SELECT 1 FROM group_topics gt JOIN user_topics ut ON ut.topic_id = gt.topic_id WHERE gt.group_id = g.id AND ut.user_id = $1)
     ORDER BY shared_topics DESC, g.created_at DESC LIMIT $2`, [userId, limit]);
}

export function groupRoutes(router: Router) {
  route(router, {
    tag, method: 'get', path: '/api/public/groups', summary: 'Newest public groups, for the landing page preview', access: 'public',
    handler: async () => ({
      items: await q(`SELECT g.id, g.name, g.difficulty, g.capacity,
          (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count,
          COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM group_topics gt JOIN topics t ON t.id = gt.topic_id WHERE gt.group_id = g.id), '{}') AS topics
        FROM study_groups g WHERE g.deleted_at IS NULL AND g.visibility = 'public' ORDER BY g.created_at DESC LIMIT 3`),
    }),
  });

  route(router, {
    tag, method: 'get', path: '/api/groups', summary: 'Browse and search study groups', access: COLLABORATORS,
    query: pageQuery.extend({
      q: text(80).default(''), subjects: csv, difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
      maxSize: z.coerce.number().int().min(2).max(200).optional(), mine: z.enum(['true', 'false']).default('false'),
    }),
    handler: async ({ user, query }) => {
      const params: unknown[] = [user.id];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const member = `EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1)`;
      const where = ['g.deleted_at IS NULL', query.mine === 'true' ? member : `(g.visibility = 'public' OR ${member})`];
      if (query.q) where.push(`lower(g.name) LIKE lower(${add(`%${query.q.replace(/[%_\\]/g, '\\$&')}%`)})`);
      if (query.subjects.length) where.push(`EXISTS (SELECT 1 FROM group_topics gt JOIN topics t ON t.id = gt.topic_id WHERE gt.group_id = g.id AND lower(t.name) = ANY(${add(query.subjects.map((s) => s.toLowerCase()))}))`);
      if (query.difficulty) where.push(`g.difficulty = ${add(query.difficulty)}`);
      if (query.maxSize) where.push(`g.capacity <= ${add(query.maxSize)}`);
      const rows = await q(`SELECT ${GROUP_FIELDS}, count(*) OVER()::int AS total_count FROM study_groups g JOIN users o ON o.id = g.owner_id
        WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC, g.id LIMIT ${add(query.pageSize)} OFFSET ${add(offset(query))}`, params);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/groups', summary: 'Create a study group or academic community', access: COLLABORATORS, body: groupBody,
    handler: ({ user, body }) => createGroup(user, body),
  });

  route(router, {
    tag, method: 'get', path: '/api/groups/:id', summary: 'Group overview', access: COLLABORATORS, params: idParam,
    handler: ({ user, params }) => getGroup(params.id, user.id),
  });

  route(router, {
    tag, method: 'patch', path: '/api/groups/:id', summary: 'Update group settings', access: COLLABORATORS, params: idParam,
    body: groupBody.omit({ kind: true }).partial(),
    handler: async ({ user, params, body }) => {
      await requireManager(params.id, user.id);
      await tx(async () => {
        if (body.capacity !== undefined) {
          const { count } = (await one('SELECT count(*)::int AS count FROM group_members WHERE group_id = $1', [params.id]))!;
          if (body.capacity < count) throw badRequest(`Capacity cannot be below the current ${count} members.`);
        }
        await q(`UPDATE study_groups SET name = COALESCE($2, name), description = COALESCE($3, description), objectives = COALESCE($4, objectives),
            difficulty = COALESCE($5, difficulty), capacity = COALESCE($6, capacity), visibility = COALESCE($7, visibility), updated_at = now() WHERE id = $1`,
          [params.id, body.name ?? null, body.description ?? null, body.objectives ?? null, body.difficulty ?? null, body.capacity ?? null, body.visibility ?? null]);
        if (body.subjects) await setGroupTopics(params.id, body.subjects);
        await recordActivity(params.id, user.id, 'updated the group settings');
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'delete', path: '/api/groups/:id', summary: 'Delete a group (owner only)', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      if ((await memberRole(params.id, user.id)) !== 'owner') throw forbidden('Only the group owner can delete it.');
      await q('UPDATE study_groups SET deleted_at = now() WHERE id = $1', [params.id]);
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/groups/:id/join', summary: 'Request to join a public group', access: COLLABORATORS, params: idParam,
    body: z.object({ message: text(500).default('') }),
    handler: async ({ user, params, body }) => {
      const group = await getGroup(params.id, user.id);
      if (group.myRole) throw conflict('You are already a member.');
      if (group.visibility === 'private') throw forbidden('Private groups are joined by invitation.');
      if (group.memberCount >= group.capacity) throw conflict('This group is full.', 'GROUP_FULL');
      if (group.hasPendingRequest) throw conflict('Your request is already pending.');
      await q('INSERT INTO group_join_requests (group_id, user_id, message) VALUES ($1, $2, $3)', [params.id, user.id, body.message]);
      const managers = await q(`SELECT user_id FROM group_members WHERE group_id = $1 AND role IN ('owner', 'leader')`, [params.id]);
      await Promise.all(managers.map((m) => notify(m.userId, 'group_join', { title: `${user.fullName} asked to join ${group.name}`, link: `/app/groups/${params.id}?tab=members` })));
      return { status: 'pending' };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/groups/:id/leave', summary: 'Leave a group', access: COLLABORATORS, params: idParam, status: 200,
    handler: async ({ user, params }) => {
      const role = await requireMember(params.id, user.id);
      if (role === 'owner') throw badRequest('Transfer ownership to another member before leaving.');
      await removeMember(params.id, user.id);
      await recordActivity(params.id, user.id, 'left the group');
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/groups/:id/members', summary: 'Group members', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      await requireMember(params.id, user.id);
      return { items: await q(`SELECT u.id, u.full_name, u.avatar_file_id, u.role AS account_role, m.role, m.joined_at FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'leader' THEN 1 ELSE 2 END, u.full_name`, [params.id]) };
    },
  });

  const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

  route(router, {
    tag, method: 'patch', path: '/api/groups/:id/members/:userId', summary: 'Change a member role or transfer ownership', access: COLLABORATORS, params: memberParams,
    body: z.object({ role: z.enum(['owner', 'leader', 'member']) }),
    handler: async ({ user, params, body }) => {
      if (!canChangeMemberRole(await requireMember(params.id, user.id))) throw forbidden('Only the group owner can change roles.');
      if (params.userId === user.id) throw badRequest('You cannot change your own role.');
      if (!(await memberRole(params.id, params.userId))) throw notFound('Member');
      await tx(async () => {
        if (body.role === 'owner') {
          await q(`UPDATE group_members SET role = 'leader' WHERE group_id = $1 AND user_id = $2`, [params.id, user.id]);
          await q('UPDATE study_groups SET owner_id = $2 WHERE id = $1', [params.id, params.userId]);
        }
        await q('UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2', [params.id, params.userId, body.role]);
        await recordActivity(params.id, user.id, 'changed a member role', body.role);
      });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'delete', path: '/api/groups/:id/members/:userId', summary: 'Remove a member', access: COLLABORATORS, params: memberParams,
    handler: async ({ user, params }) => {
      const actor = await requireMember(params.id, user.id);
      const target = await memberRole(params.id, params.userId);
      if (!target) throw notFound('Member');
      if (!canRemoveMember(actor, target)) throw forbidden();
      await removeMember(params.id, params.userId);
      await recordActivity(params.id, user.id, 'removed a member');
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/groups/:id/requests', summary: 'Pending join requests', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      await requireManager(params.id, user.id);
      return { items: await q(`SELECT r.id, r.message, r.created_at, u.id AS user_id, u.full_name, u.avatar_file_id FROM group_join_requests r JOIN users u ON u.id = r.user_id
        WHERE r.group_id = $1 AND r.status = 'pending' ORDER BY r.created_at`, [params.id]) };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/groups/:id/requests/:requestId', summary: 'Approve or reject a join request', access: COLLABORATORS,
    params: z.object({ id: z.uuid(), requestId: z.uuid() }), body: z.object({ action: z.enum(['approve', 'reject']) }),
    handler: async ({ user, params, body }) => {
      await requireManager(params.id, user.id);
      const group = await getGroup(params.id, user.id);
      const request = await tx(async () => {
        const row = await one(`UPDATE group_join_requests SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3 AND group_id = $4 AND status = 'pending' RETURNING user_id`,
          [body.action === 'approve' ? 'approved' : 'rejected', user.id, params.requestId, params.id]);
        if (!row) throw notFound('Request');
        if (body.action === 'approve') {
          await addMember(params.id, row.userId);
          await recordActivity(params.id, row.userId, 'joined the group');
        }
        return row;
      });
      await notify(request.userId, 'group_join', { title: body.action === 'approve' ? `You joined ${group.name}` : `Your request to join ${group.name} was declined`, link: body.action === 'approve' ? `/app/groups/${params.id}` : '/app/groups' });
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/groups/:id/invitations', summary: 'Invite a connection to a group', access: COLLABORATORS, params: idParam,
    body: z.object({ userId: z.uuid() }),
    handler: async ({ user, params, body }) => {
      const role = await requireMember(params.id, user.id);
      const group = await getGroup(params.id, user.id);
      if (group.visibility === 'private' && !canManageGroup(role)) throw forbidden('Only owners and leaders can invite people to a private group.');
      if (await memberRole(params.id, body.userId)) throw conflict('That person is already a member.');
      if (await isBlockedBetween(user.id, body.userId)) throw notFound('User');
      const invitee = await one(`SELECT 1 AS x FROM connections WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid) AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`, [user.id, body.userId]);
      const mentee = user.role === 'teacher' && await one(`SELECT 1 AS x FROM mentorships WHERE teacher_id = $1 AND student_id = $2 AND status = 'accepted'`, [user.id, body.userId]);
      if (!invitee && !mentee) throw forbidden('You can only invite people you are connected with.');
      const created = await one(`INSERT INTO group_invitations (group_id, inviter_id, invitee_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`, [params.id, user.id, body.userId]);
      if (!created) throw conflict('An invitation is already pending.');
      await notify(body.userId, 'group_invitation', { title: `${user.fullName} invited you to ${group.name}`, link: '/app/groups?tab=invitations' });
      return created;
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/invitations', summary: 'My pending group invitations', access: COLLABORATORS,
    handler: async ({ user }) => ({ items: await q(`SELECT i.id, i.created_at, g.id AS group_id, g.name AS group_name, u.full_name AS inviter_name FROM group_invitations i
      JOIN study_groups g ON g.id = i.group_id JOIN users u ON u.id = i.inviter_id WHERE i.invitee_id = $1 AND i.status = 'pending' AND g.deleted_at IS NULL ORDER BY i.created_at DESC`, [user.id]) }),
  });

  route(router, {
    tag, method: 'patch', path: '/api/invitations/:id', summary: 'Accept or decline an invitation', access: COLLABORATORS, params: idParam,
    body: z.object({ action: z.enum(['accept', 'decline']) }),
    handler: async ({ user, params, body }) => {
      return tx(async () => {
        const row = await one(`UPDATE group_invitations SET status = $1, responded_at = now() WHERE id = $2 AND invitee_id = $3 AND status = 'pending' RETURNING group_id`,
          [body.action === 'accept' ? 'accepted' : 'declined', params.id, user.id]);
        if (!row) throw notFound('Invitation');
        if (body.action === 'accept') {
          await addMember(row.groupId, user.id);
          await recordActivity(row.groupId, user.id, 'joined the group');
        }
        return { groupId: row.groupId };
      });
    },
  });

  // Workspace --------------------------------------------------------------

  const wtag = 'Group Workspace';

  route(router, {
    tag: wtag, method: 'get', path: '/api/groups/:id/workspace', summary: 'Workspace summary: progress, deadlines, activity', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      await requireMember(params.id, user.id);
      const [progress, deadlines, activity, announcements] = await Promise.all([
        one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed FROM tasks WHERE group_id = $1`, [params.id]),
        q(`SELECT t.id, t.title, t.due_at, t.status, t.project_id FROM tasks t WHERE t.group_id = $1 AND t.status <> 'completed' AND t.due_at IS NOT NULL ORDER BY t.due_at LIMIT 8`, [params.id]),
        q(`SELECT a.id, a.verb, a.detail, a.created_at, u.full_name AS actor_name FROM group_activity a LEFT JOIN users u ON u.id = a.actor_id WHERE a.group_id = $1 ORDER BY a.created_at DESC LIMIT 25`, [params.id]),
        q(`SELECT a.id, a.title, a.body, a.created_at, u.full_name AS author_name FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.group_id = $1 ORDER BY a.created_at DESC LIMIT 20`, [params.id]),
      ]);
      const conversation = await one(`SELECT id FROM conversations WHERE type = 'group' AND group_id = $1`, [params.id]);
      return { progress, deadlines, activity, announcements, conversationId: conversation?.id ?? null };
    },
  });

  route(router, {
    tag: wtag, method: 'post', path: '/api/groups/:id/announcements', summary: 'Post an announcement', access: COLLABORATORS, params: idParam,
    body: z.object({ title: required(160), body: required(4000) }),
    handler: async ({ user, params, body }) => {
      await requireManager(params.id, user.id);
      const group = await getGroup(params.id, user.id);
      const created = await one('INSERT INTO announcements (group_id, author_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id', [params.id, user.id, body.title, body.body]);
      await recordActivity(params.id, user.id, 'posted an announcement', body.title);
      await notifyMany(await memberIds(params.id, user.id), 'announcement', { title: `${group.name}: ${body.title}`, body: body.body.slice(0, 200), link: `/app/groups/${params.id}` });
      return created;
    },
  });

  route(router, {
    tag: wtag, method: 'get', path: '/api/groups/:id/tasks', summary: 'Tasks in a group', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      await requireMember(params.id, user.id);
      return { items: await q(`SELECT t.*, u.full_name AS assignee_name, p.title AS project_title FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN projects p ON p.id = t.project_id WHERE t.group_id = $1 ORDER BY t.due_at NULLS LAST, t.created_at`, [params.id]) };
    },
  });

  route(router, {
    tag: wtag, method: 'post', path: '/api/groups/:id/tasks', summary: 'Create a group task', access: COLLABORATORS, params: idParam, body: taskBody(),
    handler: async ({ user, params, body }) => {
      await requireMember(params.id, user.id);
      return createTask(user, params.id, null, body);
    },
  });

  route(router, {
    tag: wtag, method: 'patch', path: '/api/tasks/:id', summary: 'Update a task', access: COLLABORATORS, params: idParam,
    body: taskBody().partial().extend({ status: z.enum(TASK_STATUSES).optional() }),
    handler: async ({ user, params, body }) => {
      const task = await one('SELECT * FROM tasks WHERE id = $1', [params.id]);
      if (!task) throw notFound('Task');
      const role = await requireMember(task.groupId, user.id);
      if (task.projectId && !canManageGroup(role) && !(await one('SELECT 1 AS x FROM project_members WHERE project_id = $1 AND user_id = $2', [task.projectId, user.id]))) {
        throw forbidden('Only members of this project can change its tasks.');
      }
      if (body.assigneeId && !(await memberRole(task.groupId, body.assigneeId))) throw badRequest('Tasks can only be assigned to group members.');
      const status = body.status ?? task.status;
      const updated = await one(`UPDATE tasks SET title = COALESCE($2, title), description = COALESCE($3, description), status = $4,
          assignee_id = CASE WHEN $5 THEN $6::uuid ELSE assignee_id END, due_at = CASE WHEN $7 THEN $8::timestamptz ELSE due_at END,
          completed_at = CASE WHEN $4 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1 RETURNING *`,
        [params.id, body.title ?? null, body.description ?? null, status, body.assigneeId !== undefined, body.assigneeId ?? null, body.dueAt !== undefined, body.dueAt ?? null]);
      if (body.status && body.status !== task.status) await recordActivity(task.groupId, user.id, `moved a task to ${body.status.replace('_', ' ')}`, task.title);
      const assignee = updated.assigneeId;
      if (assignee && assignee !== user.id && (body.assigneeId !== undefined || body.status)) {
        await notify(assignee, 'task_update', { title: `Task updated: ${updated.title}`, body: `Status: ${updated.status.replace('_', ' ')}`, link: updated.projectId ? `/app/projects/${updated.projectId}` : `/app/groups/${updated.groupId}?tab=tasks` });
      }
      return updated;
    },
  });

  route(router, {
    tag: wtag, method: 'delete', path: '/api/tasks/:id', summary: 'Delete a task', access: COLLABORATORS, params: idParam,
    handler: async ({ user, params }) => {
      const task = await one('SELECT * FROM tasks WHERE id = $1', [params.id]);
      if (!task) throw notFound('Task');
      const role = await requireMember(task.groupId, user.id);
      if (!canManageGroup(role) && task.createdBy !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Only the task creator or a group manager can delete it.');
      await q('DELETE FROM tasks WHERE id = $1', [params.id]);
      return { ok: true };
    },
  });
}

export function taskBody() {
  return z.object({
    title: required(200),
    description: text(4000).default(''),
    assigneeId: z.uuid().nullable().optional(),
    dueAt: isoDate.nullable().optional(),
  });
}

export async function createTask(user: AuthUser, groupId: string, projectId: string | null, body: { title: string; description?: string; assigneeId?: string | null; dueAt?: string | null }) {
  if (body.assigneeId && !(await memberRole(groupId, body.assigneeId))) throw badRequest('Tasks can only be assigned to group members.');
  const task = await one(`INSERT INTO tasks (group_id, project_id, title, description, assignee_id, created_by, due_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [groupId, projectId, body.title, body.description ?? '', body.assigneeId ?? null, user.id, body.dueAt ?? null]);
  await recordActivity(groupId, user.id, 'created a task', body.title);
  if (body.assigneeId && body.assigneeId !== user.id) {
    await notify(body.assigneeId, 'task_update', { title: `New task assigned: ${body.title}`, link: projectId ? `/app/projects/${projectId}` : `/app/groups/${groupId}?tab=tasks` });
  }
  return task;
}
