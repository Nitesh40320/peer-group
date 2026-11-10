// Teacher verification, mentorship, assignments, dashboards, progress and notifications.
import type { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/core.js';
import { idParam, isoDate, offset, paged, pageQuery, required, route, text, topicList } from '../lib/route.js';
import { notify, notifyMany, saveUpload } from '../lib/services.js';
import { memberIds, memberRole, recommendGroups } from './groups.js';
import { recommendPartners, studentProfile } from './people.js';
import { studentProfileCompletion } from './rules.js';

function verificationRoutes(router: Router) {
  const tag = 'Teachers';

  route(router, {
    tag, method: 'get', path: '/api/teacher/verification', summary: 'My verification status and history', access: ['teacher'],
    handler: async ({ user }) => ({
      status: user.teacherStatus,
      history: await q(`SELECT v.id, v.statement, v.status, v.decision_note, v.created_at, v.decided_at, f.original_name AS document_name FROM teacher_verifications v LEFT JOIN files f ON f.id = v.document_file_id WHERE v.teacher_id = $1 ORDER BY v.created_at DESC`, [user.id]),
    }),
  });

  route(router, {
    tag, method: 'post', path: '/api/teacher/verification', summary: 'Submit verification details and an optional document', access: ['teacher'], upload: 'file',
    body: z.object({ statement: required(2000) }),
    handler: async ({ user, body, file }) => {
      if (user.teacherStatus === 'approved') throw conflict('Your account is already approved.');
      const saved = file ? await saveUpload(user.id, file, 'verification') : null;
      await tx(async () => {
        const open = await one(`SELECT id FROM teacher_verifications WHERE teacher_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [user.id]);
        if (open) await q('UPDATE teacher_verifications SET statement = $2, document_file_id = COALESCE($3, document_file_id) WHERE id = $1', [open.id, body.statement, saved?.id ?? null]);
        else await q('INSERT INTO teacher_verifications (teacher_id, statement, document_file_id) VALUES ($1, $2, $3)', [user.id, body.statement, saved?.id ?? null]);
        await q(`UPDATE teacher_profiles SET verification_status = 'pending' WHERE user_id = $1`, [user.id]);
      });
      return { status: 'pending' };
    },
  });
}

function mentorshipRoutes(router: Router) {
  const tag = 'Mentorship';

  route(router, {
    tag, method: 'get', path: '/api/mentorship', summary: 'My mentorship requests and relationships', access: ['student', 'approved_teacher'],
    handler: async ({ user }) => {
      const column = user.role === 'teacher' ? 'teacher_id' : 'student_id';
      const otherColumn = user.role === 'teacher' ? 'student_id' : 'teacher_id';
      return {
        items: await q(`SELECT m.*, o.id AS other_id, o.full_name AS other_name, o.avatar_file_id AS other_avatar,
            COALESCE((SELECT json_agg(json_build_object('id', f.id, 'body', f.body, 'createdAt', f.created_at) ORDER BY f.created_at DESC) FROM mentorship_feedback f WHERE f.mentorship_id = m.id), '[]') AS feedback
          FROM mentorships m JOIN users o ON o.id = m.${otherColumn} WHERE m.${column} = $1
          ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, m.created_at DESC`, [user.id]),
      };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/mentorship/requests', summary: 'Ask a verified teacher for mentorship', access: ['student'],
    body: z.object({ teacherId: z.uuid(), objective: required(2000), topics: topicList.default([]) }),
    handler: async ({ user, body }) => {
      const teacher = await one(`SELECT u.id FROM users u JOIN teacher_profiles p ON p.user_id = u.id WHERE u.id = $1 AND u.status = 'active' AND p.verification_status = 'approved'`, [body.teacherId]);
      if (!teacher) throw notFound('Teacher');
      const created = await one(`INSERT INTO mentorships (student_id, teacher_id, objective, topics) VALUES ($1, $2, $3, $4) ON CONFLICT (student_id, teacher_id) WHERE status IN ('pending', 'accepted') DO NOTHING RETURNING id, status`,
        [user.id, body.teacherId, body.objective, body.topics]);
      if (!created) throw conflict('You already have an open request with this teacher.');
      await notify(body.teacherId, 'mentorship', { title: `${user.fullName} requested mentorship`, body: body.objective.slice(0, 200), link: '/app/mentorship' });
      return created;
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/mentorship/requests/:id', summary: 'Accept, reject or end a mentorship', access: ['student', 'approved_teacher'], params: idParam,
    body: z.object({ action: z.enum(['accept', 'reject', 'end']), note: text(1000).default('') }),
    handler: async ({ user, params, body }) => {
      const m = await one('SELECT * FROM mentorships WHERE id = $1 AND (student_id = $2 OR teacher_id = $2)', [params.id, user.id]);
      if (!m) throw notFound('Mentorship');
      if (body.action !== 'end' && user.id !== m.teacherId) throw forbidden('Only the teacher can respond to this request.');
      const next = { accept: 'accepted', reject: 'rejected', end: 'ended' }[body.action];
      const expected = body.action === 'end' ? 'accepted' : 'pending';
      const updated = await one(`UPDATE mentorships SET status = $1, response_note = $2, responded_at = now() WHERE id = $3 AND status = $4 RETURNING id`, [next, body.note, params.id, expected]);
      if (!updated) throw conflict('This mentorship is no longer in that state.');
      await notify(user.id === m.teacherId ? m.studentId : m.teacherId, 'mentorship', { title: `Mentorship ${next} by ${user.fullName}`, body: body.note, link: '/app/mentorship' });
      return { status: next };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/mentorship/:id/feedback', summary: 'Give feedback within a mentorship', access: ['approved_teacher'], params: idParam,
    body: z.object({ body: required(4000) }),
    handler: async ({ user, params, body }) => {
      const m = await one(`SELECT student_id FROM mentorships WHERE id = $1 AND teacher_id = $2 AND status = 'accepted'`, [params.id, user.id]);
      if (!m) throw notFound('Mentorship');
      const created = await one('INSERT INTO mentorship_feedback (mentorship_id, author_id, body) VALUES ($1, $2, $3) RETURNING id', [params.id, user.id, body.body]);
      await notify(m.studentId, 'mentorship', { title: `${user.fullName} left mentorship feedback`, link: '/app/mentorship' });
      return created;
    },
  });
}

function assignmentRoutes(router: Router) {
  const tag = 'Assignments';

  route(router, {
    tag, method: 'get', path: '/api/assignments', summary: 'Assignments I set or received', access: ['student', 'approved_teacher'], query: pageQuery,
    handler: async ({ user, query }) => {
      const rows = user.role === 'teacher'
        ? await q(`SELECT a.*, g.name AS group_name, (SELECT count(*)::int FROM assignment_recipients r WHERE r.assignment_id = a.id) AS recipient_count,
              (SELECT count(*)::int FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
              (SELECT count(*)::int FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'submitted') AS pending_review, count(*) OVER()::int AS total_count
            FROM assignments a LEFT JOIN study_groups g ON g.id = a.group_id WHERE a.teacher_id = $1 ORDER BY a.due_at DESC LIMIT $2 OFFSET $3`, [user.id, query.pageSize, offset(query)])
        : await q(`SELECT a.*, g.name AS group_name, u.full_name AS teacher_name, s.status AS submission_status, s.submitted_at, count(*) OVER()::int AS total_count
            FROM assignment_recipients r JOIN assignments a ON a.id = r.assignment_id JOIN users u ON u.id = a.teacher_id LEFT JOIN study_groups g ON g.id = a.group_id
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = r.student_id WHERE r.student_id = $1 ORDER BY a.due_at LIMIT $2 OFFSET $3`, [user.id, query.pageSize, offset(query)]);
      return paged(rows, query);
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/assignments', summary: 'Create an assignment for a group or mentees', access: ['approved_teacher'],
    body: z.object({ title: required(160), description: text(4000).default(''), dueAt: isoDate, groupId: z.uuid().nullable().optional(), studentIds: z.array(z.uuid()).max(200).default([]), resourceId: z.uuid().nullable().optional() })
      .refine((b) => b.groupId || b.studentIds.length, 'Choose a group or at least one student.'),
    handler: async ({ user, body }) => {
      const recipients = new Set<string>();
      if (body.groupId) {
        if (!(await memberRole(body.groupId, user.id))) throw forbidden('You can only assign work to groups you belong to.');
        const students = await q(`SELECT m.user_id FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 AND u.role = 'student'`, [body.groupId]);
        students.forEach((s) => recipients.add(s.userId));
      }
      if (body.studentIds.length) {
        const allowed = await q(`SELECT student_id FROM mentorships WHERE teacher_id = $1 AND status = 'accepted' AND student_id = ANY($2::uuid[])`, [user.id, body.studentIds]);
        if (allowed.length !== new Set(body.studentIds).size) throw forbidden('You can only assign work directly to students you mentor.');
        allowed.forEach((s) => recipients.add(s.studentId));
      }
      if (!recipients.size) throw badRequest('That selection has no students.');
      if (body.resourceId) {
        const res = await one('SELECT owner_id, group_id FROM resources WHERE id = $1', [body.resourceId]);
        if (!res || (res.ownerId !== user.id && res.groupId && !(await memberRole(res.groupId, user.id)))) throw notFound('Resource');
      }
      const created = await tx(async () => {
        const a = (await one('INSERT INTO assignments (teacher_id, group_id, title, description, due_at, resource_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [user.id, body.groupId ?? null, body.title, body.description, body.dueAt, body.resourceId ?? null]))!;
        await q('INSERT INTO assignment_recipients (assignment_id, student_id) SELECT $1, unnest($2::uuid[])', [a.id, [...recipients]]);
        return a;
      });
      await notifyMany([...recipients], 'assignment_deadline', { title: `New assignment: ${body.title}`, body: `Due ${new Date(body.dueAt).toUTCString()}`, link: `/app/assignments/${created.id}` });
      return created;
    },
  });

  const loadAssignment = async (id: string, userId: string) => {
    const a = await one(`SELECT a.*, g.name AS group_name, u.full_name AS teacher_name, r.title AS resource_title, r.kind AS resource_kind, r.url AS resource_url, r.file_id AS resource_file_id
      FROM assignments a JOIN users u ON u.id = a.teacher_id LEFT JOIN study_groups g ON g.id = a.group_id LEFT JOIN resources r ON r.id = a.resource_id WHERE a.id = $1`, [id]);
    if (!a) throw notFound('Assignment');
    const isTeacher = a.teacherId === userId;
    if (!isTeacher && !(await one('SELECT 1 AS x FROM assignment_recipients WHERE assignment_id = $1 AND student_id = $2', [id, userId]))) throw notFound('Assignment');
    return { a, isTeacher };
  };

  route(router, {
    tag, method: 'get', path: '/api/assignments/:id', summary: 'Assignment detail with submissions', access: ['student', 'approved_teacher'], params: idParam,
    handler: async ({ user, params }) => {
      const { a, isTeacher } = await loadAssignment(params.id, user.id);
      const submissions = await q(`SELECT s.*, u.full_name AS student_name, f.original_name AS file_name FROM submissions s JOIN users u ON u.id = s.student_id LEFT JOIN files f ON f.id = s.file_id
        WHERE s.assignment_id = $1 AND ($2 OR s.student_id = $3) ORDER BY s.submitted_at DESC`, [params.id, isTeacher, user.id]);
      return { ...a, isTeacher, submissions };
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/assignments/:id', summary: 'Edit or close an assignment', access: ['approved_teacher'], params: idParam,
    body: z.object({ title: required(160), description: text(4000), dueAt: isoDate, status: z.enum(['active', 'closed']) }).partial(),
    handler: async ({ user, params, body }) => {
      const row = await one(`UPDATE assignments SET title = COALESCE($3, title), description = COALESCE($4, description), due_at = COALESCE($5, due_at), status = COALESCE($6, status),
          reminded_at = CASE WHEN $5::timestamptz IS NULL THEN reminded_at ELSE NULL END, updated_at = now() WHERE id = $1 AND teacher_id = $2 RETURNING id`,
      [params.id, user.id, body.title ?? null, body.description ?? null, body.dueAt ?? null, body.status ?? null]);
      if (!row) throw notFound('Assignment');
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/assignments/:id/submission', summary: 'Submit or resubmit work', access: ['student'], params: idParam, upload: 'file',
    body: z.object({ body: text(8000).default('') }),
    handler: async ({ user, params, body, file }) => {
      const { a } = await loadAssignment(params.id, user.id);
      if (a.status === 'closed') throw badRequest('This assignment is closed.');
      if (!body.body && !file) throw badRequest('Write a response or attach a file.');
      const saved = file ? await saveUpload(user.id, file, 'submission') : null;
      const row = await one(`INSERT INTO submissions (assignment_id, student_id, body, file_id) VALUES ($1, $2, $3, $4)
        ON CONFLICT (assignment_id, student_id) DO UPDATE SET body = EXCLUDED.body, file_id = COALESCE(EXCLUDED.file_id, submissions.file_id), status = 'submitted', submitted_at = now()
        WHERE submissions.status <> 'completed' RETURNING id, status`, [params.id, user.id, body.body, saved?.id ?? null]);
      if (!row) throw conflict('This submission has already been marked complete.');
      await notify(a.teacherId, 'assignment_deadline', { title: `${user.fullName} submitted ${a.title}`, link: `/app/assignments/${params.id}` });
      return row;
    },
  });

  route(router, {
    tag, method: 'patch', path: '/api/submissions/:id', summary: 'Review a submission', access: ['approved_teacher'], params: idParam,
    body: z.object({ status: z.enum(['needs_changes', 'completed']), feedback: text(4000).default('') }),
    handler: async ({ user, params, body }) => {
      const row = await one(`UPDATE submissions s SET status = $1, feedback = $2, reviewed_by = $3, reviewed_at = now() FROM assignments a
        WHERE s.id = $4 AND a.id = s.assignment_id AND a.teacher_id = $3 RETURNING s.student_id, s.assignment_id, a.title`, [body.status, body.feedback, user.id, params.id]);
      if (!row) throw notFound('Submission');
      await notify(row.studentId, 'assignment_deadline', { title: `Feedback on ${row.title}`, body: body.feedback.slice(0, 200), link: `/app/assignments/${row.assignmentId}` });
      return { ok: true };
    },
  });
}

function dashboardRoutes(router: Router) {
  route(router, {
    tag: 'Dashboards', method: 'get', path: '/api/student/dashboard', summary: 'Student dashboard data', access: ['student'],
    handler: async ({ user }) => {
      const profile = await studentProfile(user.id);
      const [partners, groups, sessions, invitations, conversations, projects, deadlines, activity, progress] = await Promise.all([
        recommendPartners(user.id, 4),
        recommendGroups(user.id, 4),
        q(`SELECT s.id, s.title, s.starts_at, s.duration_minutes, g.name AS group_name FROM study_sessions s LEFT JOIN study_groups g ON g.id = s.group_id
            JOIN session_participants p ON p.session_id = s.id AND p.user_id = $1 WHERE s.status = 'scheduled' AND s.starts_at >= now() ORDER BY s.starts_at LIMIT 5`, [user.id]),
        q(`SELECT i.id, g.id AS group_id, g.name AS group_name, u.full_name AS inviter_name FROM group_invitations i JOIN study_groups g ON g.id = i.group_id JOIN users u ON u.id = i.inviter_id
            WHERE i.invitee_id = $1 AND i.status = 'pending' AND g.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 5`, [user.id]),
        q(`SELECT c.id, CASE c.type WHEN 'group' THEN g.name WHEN 'project' THEN p.title ELSE other.full_name END AS title, c.last_message_at,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.created_at > me.last_read_at AND m.sender_id IS DISTINCT FROM $1) AS unread_count
            FROM conversation_members me JOIN conversations c ON c.id = me.conversation_id LEFT JOIN study_groups g ON g.id = c.group_id LEFT JOIN projects p ON p.id = c.project_id
            LEFT JOIN LATERAL (SELECT u.full_name FROM conversation_members o JOIN users u ON u.id = o.user_id WHERE c.type = 'direct' AND o.conversation_id = c.id AND o.user_id <> $1 LIMIT 1) other ON true
            WHERE me.user_id = $1 AND c.last_message_at IS NOT NULL ORDER BY c.last_message_at DESC LIMIT 5`, [user.id]),
        q(`SELECT p.id, p.title, g.name AS group_name, (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count, (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_count
            FROM projects p JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 JOIN study_groups g ON g.id = p.group_id AND g.deleted_at IS NULL WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT 5`, [user.id]),
        q(`(SELECT 'task' AS type, t.id, t.title, t.due_at, COALESCE('/app/projects/' || t.project_id::text, '/app/groups/' || t.group_id::text || '?tab=tasks') AS link FROM tasks t WHERE t.assignee_id = $1 AND t.status <> 'completed' AND t.due_at IS NOT NULL)
            UNION ALL (SELECT 'assignment' AS type, a.id, a.title, a.due_at, '/app/assignments/' || a.id::text AS link FROM assignments a JOIN assignment_recipients r ON r.assignment_id = a.id AND r.student_id = $1
              LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = $1 WHERE a.status = 'active' AND s.id IS NULL) ORDER BY due_at LIMIT 6`, [user.id]),
        q(`SELECT a.id, a.verb, a.detail, a.created_at, u.full_name AS actor_name, g.id AS group_id, g.name AS group_name FROM group_activity a JOIN group_members m ON m.group_id = a.group_id AND m.user_id = $1
            JOIN study_groups g ON g.id = a.group_id AND g.deleted_at IS NULL LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 8`, [user.id]),
        progressFor(user.id),
      ]);
      return { completion: studentProfileCompletion(profile), partners, groups, sessions, invitations, conversations, projects, deadlines, activity, progress };
    },
  });

  async function progressFor(userId: string) {
    return (await one(`SELECT
      (SELECT count(*)::int FROM tasks WHERE assignee_id = $1 AND status = 'completed') AS completed_tasks,
      (SELECT count(*)::int FROM tasks WHERE assignee_id = $1 AND status <> 'completed') AS open_tasks,
      (SELECT count(*)::int FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = $1 AND p.status = 'active') AS active_projects,
      (SELECT count(*)::int FROM session_participants WHERE user_id = $1 AND attended_at IS NOT NULL) AS sessions_attended,
      (SELECT count(*)::int FROM group_activity WHERE actor_id = $1) AS group_contributions,
      (SELECT count(*)::int FROM milestones mi JOIN project_members pm ON pm.project_id = mi.project_id WHERE pm.user_id = $1 AND mi.completed_at IS NOT NULL) AS milestones_reached,
      (SELECT count(*)::int FROM submissions WHERE student_id = $1 AND status = 'completed') AS assignments_completed`, [userId]))!;
  }

  route(router, {
    tag: 'Progress', method: 'get', path: '/api/student/progress', summary: 'Learning progress and goals', access: ['student'],
    handler: async ({ user }) => ({
      ...(await progressFor(user.id)),
      goals: await q('SELECT id, title, completed_at, created_at FROM personal_goals WHERE user_id = $1 ORDER BY completed_at NULLS FIRST, created_at DESC', [user.id]),
      milestones: await q(`SELECT mi.id, mi.title, mi.completed_at, p.title AS project_title FROM milestones mi JOIN project_members pm ON pm.project_id = mi.project_id AND pm.user_id = $1 JOIN projects p ON p.id = mi.project_id WHERE mi.completed_at IS NOT NULL ORDER BY mi.completed_at DESC LIMIT 10`, [user.id]),
    }),
  });

  route(router, {
    tag: 'Progress', method: 'post', path: '/api/student/goals', summary: 'Add a personal goal', access: ['student'], body: z.object({ title: required(200) }),
    handler: async ({ user, body }) => one('INSERT INTO personal_goals (user_id, title) VALUES ($1, $2) RETURNING id', [user.id, body.title]),
  });

  route(router, {
    tag: 'Progress', method: 'patch', path: '/api/student/goals/:id', summary: 'Complete or reopen a goal', access: ['student'], params: idParam, body: z.object({ completed: z.boolean() }),
    handler: async ({ user, params, body }) => {
      const row = await one(`UPDATE personal_goals SET completed_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND user_id = $2 RETURNING id`, [params.id, user.id, body.completed]);
      if (!row) throw notFound('Goal');
      return { ok: true };
    },
  });

  route(router, {
    tag: 'Progress', method: 'delete', path: '/api/student/goals/:id', summary: 'Delete a goal', access: ['student'], params: idParam,
    handler: async ({ user, params }) => { await q('DELETE FROM personal_goals WHERE id = $1 AND user_id = $2', [params.id, user.id]); return { ok: true }; },
  });

  route(router, {
    tag: 'Dashboards', method: 'get', path: '/api/teacher/dashboard', summary: 'Teacher dashboard data', access: ['teacher'],
    handler: async ({ user }) => {
      if (user.teacherStatus !== 'approved') return { verificationStatus: user.teacherStatus, approved: false };
      const [stats, groups, sessions, requests, announcements, activity] = await Promise.all([
        one(`SELECT (SELECT count(*)::int FROM group_members m JOIN study_groups g ON g.id = m.group_id AND g.deleted_at IS NULL WHERE m.user_id = $1) AS active_communities,
            (SELECT count(DISTINCT s.user_id)::int FROM group_members me JOIN group_members s ON s.group_id = me.group_id JOIN users u ON u.id = s.user_id AND u.role = 'student' WHERE me.user_id = $1) AS group_students,
            (SELECT count(*)::int FROM mentorships WHERE teacher_id = $1 AND status = 'accepted') AS mentees,
            (SELECT count(*)::int FROM mentorships WHERE teacher_id = $1 AND status = 'pending') AS pending_mentorship,
            (SELECT count(*)::int FROM assignments WHERE teacher_id = $1 AND status = 'active') AS active_assignments,
            (SELECT count(*)::int FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.teacher_id = $1 AND s.status = 'submitted') AS pending_reviews`, [user.id]),
        q(`SELECT g.id, g.name, g.kind, (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count FROM study_groups g JOIN group_members me ON me.group_id = g.id AND me.user_id = $1 WHERE g.deleted_at IS NULL ORDER BY g.created_at DESC LIMIT 6`, [user.id]),
        q(`SELECT s.id, s.title, s.starts_at, s.duration_minutes, g.name AS group_name FROM study_sessions s LEFT JOIN study_groups g ON g.id = s.group_id JOIN session_participants p ON p.session_id = s.id AND p.user_id = $1 WHERE s.status = 'scheduled' AND s.starts_at >= now() ORDER BY s.starts_at LIMIT 5`, [user.id]),
        q(`SELECT m.id, m.objective, m.created_at, u.full_name AS student_name FROM mentorships m JOIN users u ON u.id = m.student_id WHERE m.teacher_id = $1 AND m.status = 'pending' ORDER BY m.created_at LIMIT 5`, [user.id]),
        q(`SELECT a.id, a.title, a.created_at, g.id AS group_id, g.name AS group_name FROM announcements a JOIN study_groups g ON g.id = a.group_id AND g.deleted_at IS NULL WHERE a.author_id = $1 ORDER BY a.created_at DESC LIMIT 5`, [user.id]),
        q(`SELECT a.id, a.verb, a.detail, a.created_at, u.full_name AS actor_name, g.id AS group_id, g.name AS group_name FROM group_activity a JOIN group_members m ON m.group_id = a.group_id AND m.user_id = $1 JOIN study_groups g ON g.id = a.group_id AND g.deleted_at IS NULL LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 8`, [user.id]),
      ]);
      return { approved: true, verificationStatus: user.teacherStatus, stats, groups, sessions, requests, announcements, activity };
    },
  });

  route(router, {
    tag: 'Dashboards', method: 'get', path: '/api/teacher/analytics', summary: 'Group engagement indicators (not academic grades)', access: ['approved_teacher'],
    handler: async ({ user }) => ({
      groups: await q(`SELECT g.id, g.name,
          (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
          (SELECT count(*)::int FROM tasks t WHERE t.group_id = g.id) AS tasks_total,
          (SELECT count(*)::int FROM tasks t WHERE t.group_id = g.id AND t.status = 'completed') AS tasks_completed,
          (SELECT count(*)::int FROM study_sessions s WHERE s.group_id = g.id AND s.status = 'scheduled') AS sessions_total,
          (SELECT count(*)::int FROM session_participants sp JOIN study_sessions s ON s.id = sp.session_id WHERE s.group_id = g.id AND sp.attended_at IS NOT NULL) AS attendance,
          (SELECT count(*)::int FROM group_activity a WHERE a.group_id = g.id AND a.created_at > now() - interval '30 days') AS activity_30d
        FROM study_groups g JOIN group_members me ON me.group_id = g.id AND me.user_id = $1 WHERE g.deleted_at IS NULL ORDER BY g.name`, [user.id]),
      trend: await q(`SELECT to_char(date_trunc('week', a.created_at), 'YYYY-MM-DD') AS week, count(*)::int AS events FROM group_activity a JOIN group_members me ON me.group_id = a.group_id AND me.user_id = $1 WHERE a.created_at > now() - interval '8 weeks' GROUP BY 1 ORDER BY 1`, [user.id]),
      pendingMentorship: (await one(`SELECT count(*)::int AS n FROM mentorships WHERE teacher_id = $1 AND status = 'pending'`, [user.id]))!.n,
      students: await q(`SELECT u.id, u.full_name, (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.status = 'completed' AND t.group_id = ANY(gs.ids)) AS completed_tasks,
          (SELECT count(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'completed' AND t.group_id = ANY(gs.ids)) AS open_tasks
        FROM (SELECT array_agg(group_id) AS ids FROM group_members WHERE user_id = $1) gs
        JOIN LATERAL (SELECT DISTINCT user_id FROM group_members WHERE group_id = ANY(gs.ids)) sm ON true
        JOIN users u ON u.id = sm.user_id AND u.role = 'student' ORDER BY u.full_name LIMIT 100`, [user.id]),
    }),
  });
}

function notificationRoutes(router: Router) {
  const tag = 'Notifications';

  route(router, {
    tag, method: 'get', path: '/api/notifications', summary: 'My notifications', access: 'any', query: pageQuery.extend({ unread: z.enum(['true', 'false']).default('false') }),
    handler: async ({ user, query }) => {
      const rows = await q(`SELECT *, count(*) OVER()::int AS total_count FROM notifications WHERE user_id = $1 AND ($2 = 'false' OR read_at IS NULL) ORDER BY created_at DESC LIMIT $3 OFFSET $4`, [user.id, query.unread, query.pageSize, offset(query)]);
      const { n } = (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id]))!;
      return { ...paged(rows, query), unreadCount: n };
    },
  });

  route(router, {
    tag, method: 'get', path: '/api/notifications/unread-count', summary: 'Unread count', access: 'any',
    handler: async ({ user }) => ({ count: (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id]))!.n }),
  });

  route(router, {
    tag, method: 'patch', path: '/api/notifications/:id/read', summary: 'Mark one notification read', access: 'any', params: idParam,
    handler: async ({ user, params }) => {
      const row = await one('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id', [params.id, user.id]);
      if (!row) throw notFound('Notification');
      return { ok: true };
    },
  });

  route(router, {
    tag, method: 'post', path: '/api/notifications/read-all', summary: 'Mark all notifications read', access: 'any', status: 200,
    handler: async ({ user }) => { await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [user.id]); return { ok: true }; },
  });
}

export function guidanceRoutes(router: Router) {
  verificationRoutes(router);
  mentorshipRoutes(router);
  assignmentRoutes(router);
  dashboardRoutes(router);
  notificationRoutes(router);
}

export { memberIds };
