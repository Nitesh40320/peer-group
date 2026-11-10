import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, q } from '../src/db.js';
import { sendReminders } from '../src/jobs.js';
import { devOutbox } from '../src/lib/services.js';
import { admin, app, approvedTeacher, Client, connect, future, groupWith, PASSWORD, PDF, pendingTeacher, register, resetDatabase, student, tokenFrom, uniqueEmail } from './helpers.js';

let adminUser: Client;

beforeAll(async () => {
  await resetDatabase();
  adminUser = await admin();
});

describe('registration and login', () => {
  it('blocks sign-in until the email is verified', async () => {
    const c = await register('student');
    const res = await c.login();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('verifies once, then signs in with an HttpOnly cookie', async () => {
    const c = await register('student');
    const token = tokenFrom(c.email, 'verify-email');
    expect((await c.agent.post('/api/auth/verify-email').send({ token })).status).toBe(200);
    expect((await c.agent.post('/api/auth/verify-email').send({ token })).status).toBe(400);
    const res = await c.login();
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('never stores plaintext passwords and uses Argon2id', async () => {
    const c = await student();
    const row = (await q('SELECT password_hash FROM users WHERE id = $1', [c.id]))[0];
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it('gives the same response for existing and new emails', async () => {
    const c = await student();
    const body = { fullName: 'X', password: PASSWORD, role: 'student' };
    const taken = await request(app).post('/api/auth/register').send({ ...body, email: c.email });
    const fresh = await request(app).post('/api/auth/register').send({ ...body, email: uniqueEmail() });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
  });

  it('cannot register an administrator through the API', async () => {
    const res = await request(app).post('/api/auth/register').send({ fullName: 'X', email: uniqueEmail(), password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(422);
  });

  it('rejects wrong passwords and logs out', async () => {
    const c = await student();
    expect((await new Client().login(c.email, 'wrong-password-1')).status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const c = await student();
    const res = await c.agent.patch('/api/users/me').send({ bio: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });
});

describe('password reset', () => {
  it('resets once, revokes existing sessions and rejects the old password', async () => {
    const c = await student();
    await request(app).post('/api/auth/forgot-password').send({ email: c.email });
    const token = tokenFrom(c.email, 'reset-password');
    const next = 'brand-new-pass-7';
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: next })).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: next })).status).toBe(400);
    expect((await new Client().login(c.email, PASSWORD)).status).toBe(401);
    expect((await new Client().login(c.email, next)).status).toBe(200);
  });

  it('does not reveal whether an account exists', async () => {
    const before = devOutbox.length;
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.test' });
    expect(res.status).toBe(202);
    expect(devOutbox.length).toBe(before);
  });
});

describe('profiles and privacy', () => {
  it('updates a student profile and tracks completion', async () => {
    const c = await student();
    const res = await c.patch('/api/users/me', { institution: 'MIT', academicYear: 2, subjects: ['Data Structures'], skills: ['Python'], availability: ['mon_evening'] });
    expect(res.status).toBe(200);
    const me = await c.get('/api/users/me');
    expect(me.body.subjects).toEqual(['Data Structures']);
    expect(me.body.academicYear).toBe(2);
    expect(me.body.completion.percent).toBeGreaterThan(40);
  });

  it('rejects invalid profile data', async () => {
    const c = await student();
    expect((await c.patch('/api/users/me', { availability: ['someday'] })).status).toBe(422);
    expect((await c.patch('/api/users/me', { academicYear: 99 })).status).toBe(422);
  });

  it('does not expose emails on public profiles', async () => {
    const a = await student(); const b = await student();
    const res = await a.get(`/api/users/${b.id}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBeUndefined();
  });

  it('honours connections-only and hidden profiles', async () => {
    const a = await student(); const b = await student();
    await b.patch('/api/users/me', { visibility: 'connections', bio: 'private bio' });
    const limited = await a.get(`/api/users/${b.id}`);
    expect(limited.body.limited).toBe(true);
    expect(limited.body.bio).toBeUndefined();
    await connect(a, b);
    expect((await a.get(`/api/users/${b.id}`)).body.bio).toBe('private bio');
    const c = await student();
    await b.patch('/api/users/me', { visibility: 'hidden' });
    expect((await c.get(`/api/users/${b.id}`)).status).toBe(404);
  });
});

describe('discovery, matching and connections', () => {
  it('searches with filters and pagination, and hides hidden students', async () => {
    const a = await student('Finder');
    const b = await student('Zelda Unique');
    const hidden = await student('Zelda Hidden');
    await b.patch('/api/users/me', { subjects: ['Quantum Physics'], academicYear: 3 });
    await hidden.patch('/api/users/me', { subjects: ['Quantum Physics'], visibility: 'hidden' });
    const res = await a.get('/api/students?subjects=Quantum%20Physics&year=3&pageSize=5');
    expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([b.id]);
    expect(res.body.total).toBe(1);
  });

  it('recommends partners with an explanation and identifies the method', async () => {
    const a = await student(); const b = await student('Match Me');
    await a.patch('/api/users/me', { subjects: ['Compilers'], availability: ['tue_evening'] });
    await b.patch('/api/users/me', { subjects: ['Compilers'], availability: ['tue_evening'] });
    const res = await a.get('/api/matches');
    expect(res.body.method).toBe('weighted_rules');
    const match = res.body.items.find((m: { id: string }) => m.id === b.id);
    expect(match.explanation).toContain('Compilers');
  });

  it('runs the request, accept and remove lifecycle', async () => {
    const a = await student('A'); const b = await student('B');
    const req = await a.post('/api/connections', { userId: b.id });
    expect((await a.post('/api/connections', { userId: b.id })).status).toBe(409);
    expect((await a.patch(`/api/connections/${req.body.id}`, { action: 'accept' })).status).toBe(404);
    expect((await b.patch(`/api/connections/${req.body.id}`, { action: 'accept' })).status).toBe(200);
    expect((await b.get('/api/notifications')).body.items[0].type).toBe('connection_request');
    expect((await a.get('/api/notifications')).body.items[0].type).toBe('connection_accepted');
    expect((await a.delete(`/api/connections/${req.body.id}`)).status).toBe(200);
    expect((await a.get('/api/connections')).body.connections).toEqual([]);
  });

  it('blocks both ways', async () => {
    const a = await student(); const b = await student();
    await a.post(`/api/blocks/${b.id}`);
    expect((await b.get(`/api/users/${a.id}`)).status).toBe(404);
    expect((await b.post('/api/connections', { userId: a.id })).status).toBe(404);
  });
});

describe('study groups', () => {
  it('creates, requests, approves and opens the workspace', async () => {
    const owner = await student('Owner'); const joiner = await student('Joiner');
    const created = await owner.post('/api/groups', { name: 'Graph Theory', subjects: ['Graphs'], capacity: 5 });
    const id = created.body.id;
    expect((await joiner.get(`/api/groups/${id}/workspace`)).status).toBe(403);
    expect((await joiner.post(`/api/groups/${id}/join`, { message: 'hi' })).status).toBe(201);
    expect((await joiner.post(`/api/groups/${id}/join`, {})).status).toBe(409);
    const requests = await owner.get(`/api/groups/${id}/requests`);
    expect((await joiner.get(`/api/groups/${id}/requests`)).status).toBe(403);
    await owner.patch(`/api/groups/${id}/requests/${requests.body.items[0].id}`, { action: 'approve' });
    const workspace = await joiner.get(`/api/groups/${id}/workspace`);
    expect(workspace.status).toBe(200);
    expect(workspace.body.activity.some((a: { verb: string }) => a.verb === 'joined the group')).toBe(true);
    expect((await owner.get(`/api/groups/${id}/members`)).body.items).toHaveLength(2);
  });

  it('hides private groups from non-members and only admits by invitation', async () => {
    const owner = await student(); const friend = await student(); const stranger = await student();
    await connect(owner, friend);
    const id = await groupWith(owner, undefined, { name: 'Secret', visibility: 'private' });
    expect((await stranger.get(`/api/groups/${id}`)).status).toBe(404);
    expect((await stranger.post(`/api/groups/${id}/join`, {})).status).toBe(404);
    expect((await stranger.get('/api/groups?q=Secret')).body.total).toBe(0);
    const invite = await owner.post(`/api/groups/${id}/invitations`, { userId: friend.id });
    expect(invite.status).toBe(201);
    expect((await owner.post(`/api/groups/${id}/invitations`, { userId: stranger.id })).status).toBe(403);
    await friend.patch(`/api/invitations/${invite.body.id}`, { action: 'accept' });
    expect((await friend.get(`/api/groups/${id}/workspace`)).status).toBe(200);
  });

  it('enforces capacity under simultaneous approvals', async () => {
    const owner = await student(); const a = await student(); const b = await student();
    const id = await groupWith(owner, undefined, { capacity: 2 });
    await a.post(`/api/groups/${id}/join`, {}); await b.post(`/api/groups/${id}/join`, {});
    const { body } = await owner.get(`/api/groups/${id}/requests`);
    const results = await Promise.all(body.items.map((r: { id: string }) => owner.patch(`/api/groups/${id}/requests/${r.id}`, { action: 'approve' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await owner.get(`/api/groups/${id}/members`)).body.items).toHaveLength(2);
  });

  it('applies role rules for settings, leaving and leadership', async () => {
    const owner = await student(); const member = await student();
    const id = await groupWith(owner, member);
    expect((await member.patch(`/api/groups/${id}`, { name: 'Hack' })).status).toBe(403);
    expect((await member.delete(`/api/groups/${id}`)).status).toBe(403);
    expect((await owner.post(`/api/groups/${id}/leave`)).status).toBe(400);
    await owner.patch(`/api/groups/${id}/members/${member.id}`, { role: 'leader' });
    expect((await member.patch(`/api/groups/${id}`, { description: 'updated' })).status).toBe(200);
    await owner.patch(`/api/groups/${id}/members/${member.id}`, { role: 'owner' });
    expect((await owner.post(`/api/groups/${id}/leave`)).status).toBe(200);
  });

  it('removes a departing member from group messages', async () => {
    const owner = await student(); const member = await student();
    const id = await groupWith(owner, member);
    const convo = (await member.get(`/api/groups/${id}/workspace`)).body.conversationId;
    expect((await member.get(`/api/conversations/${convo}/messages`)).status).toBe(200);
    await member.post(`/api/groups/${id}/leave`);
    expect((await member.get(`/api/conversations/${convo}/messages`)).status).toBe(404);
  });
});

describe('projects and tasks', () => {
  it('runs tasks through the board to completion and tracks milestones', async () => {
    const owner = await student(); const member = await student();
    const groupId = await groupWith(owner, member);
    const project = await owner.post('/api/projects', { groupId, title: 'Compiler', memberIds: [member.id] });
    const task = await owner.post(`/api/projects/${project.body.id}/tasks`, { title: 'Lexer', assigneeId: member.id, dueAt: future() });
    expect(task.status).toBe(201);
    expect((await member.get('/api/notifications')).body.items.some((n: { type: string }) => n.type === 'task_update')).toBe(true);
    for (const status of ['in_progress', 'review', 'completed']) expect((await member.patch(`/api/tasks/${task.body.id}`, { status })).status).toBe(200);
    const milestone = await owner.post(`/api/projects/${project.body.id}/milestones`, { title: 'Alpha' });
    await member.patch(`/api/milestones/${milestone.body.id}`, { completed: true });
    const detail = await member.get(`/api/projects/${project.body.id}`);
    expect(detail.body.progress).toBe(100);
    expect(detail.body.milestones[0].completedAt).toBeTruthy();
  });

  it('blocks outsiders and non-project members from changing a project', async () => {
    const owner = await student(); const member = await student(); const outsider = await student();
    const groupId = await groupWith(owner, member);
    const project = await owner.post('/api/projects', { groupId, title: 'Solo' });
    const task = await owner.post(`/api/projects/${project.body.id}/tasks`, { title: 'T' });
    expect((await outsider.get(`/api/projects/${project.body.id}`)).status).toBe(404);
    expect((await member.get(`/api/projects/${project.body.id}`)).body.canModify).toBe(false);
    expect((await member.patch(`/api/projects/${project.body.id}`, { title: 'X' })).status).toBe(403);
    expect((await member.patch(`/api/tasks/${task.body.id}`, { status: 'completed' })).status).toBe(403);
    expect((await outsider.patch(`/api/tasks/${task.body.id}`, { status: 'completed' })).status).toBe(403);
  });
});

describe('messaging', () => {
  it('sends between connections with unread tracking', async () => {
    const a = await student(); const b = await student();
    await connect(a, b);
    const convo = await a.post('/api/conversations', { userId: b.id });
    expect((await a.post('/api/conversations', { userId: b.id })).body.id).toBe(convo.body.id);
    expect((await a.post(`/api/conversations/${convo.body.id}/messages`, { body: 'hello' })).status).toBe(201);
    const list = await b.get('/api/conversations');
    expect(list.body.items[0].unreadCount).toBe(1);
    await b.post(`/api/conversations/${convo.body.id}/read`);
    expect((await b.get('/api/conversations')).body.items[0].unreadCount).toBe(0);
    expect((await b.get(`/api/conversations/${convo.body.id}/messages`)).body.items[0].body).toBe('hello');
  });

  it('refuses strangers and third parties', async () => {
    const a = await student(); const b = await student(); const c = await student();
    expect((await a.post('/api/conversations', { userId: b.id })).status).toBe(403);
    await connect(a, b);
    const convo = await a.post('/api/conversations', { userId: b.id });
    expect((await c.get(`/api/conversations/${convo.body.id}/messages`)).status).toBe(404);
    expect((await c.post(`/api/conversations/${convo.body.id}/messages`, { body: 'x' })).status).toBe(404);
  });

  it('keeps attachments private to the conversation', async () => {
    const a = await student(); const b = await student(); const c = await student();
    await connect(a, b);
    const convo = await a.post('/api/conversations', { userId: b.id });
    const sent = await a.upload(`/api/conversations/${convo.body.id}/messages`, 'file', PDF, 'notes.pdf', { body: 'see this' });
    expect(sent.status).toBe(201);
    expect((await b.get(`/api/files/${sent.body.fileId}`)).status).toBe(200);
    expect((await c.get(`/api/files/${sent.body.fileId}`)).status).toBe(403);
  });
});

describe('study sessions', () => {
  it('schedules, joins, reschedules, cancels and exports a calendar file', async () => {
    const owner = await student(); const member = await student();
    const groupId = await groupWith(owner, member);
    const session = await owner.post('/api/sessions', { title: 'Review', startsAt: future(), durationMinutes: 60, groupId });
    expect((await member.post(`/api/sessions/${session.body.id}/join`)).status).toBe(200);
    expect((await member.patch(`/api/sessions/${session.body.id}`, { title: 'Hack' })).status).toBe(403);
    expect((await owner.patch(`/api/sessions/${session.body.id}`, { startsAt: future(48) })).status).toBe(200);
    expect((await member.get(`/api/sessions/${session.body.id}/calendar.ics`)).text).toContain('BEGIN:VCALENDAR');
    expect((await member.get('/api/sessions')).body.items[0].joined).toBe(true);
    await owner.patch(`/api/sessions/${session.body.id}`, { status: 'cancelled' });
    expect((await member.post(`/api/sessions/${session.body.id}/join`)).status).toBe(400);
  });

  it('rejects past dates and enforces the check-in window', async () => {
    const a = await student();
    expect((await a.post('/api/sessions', { title: 'Late', startsAt: new Date(Date.now() - 7200000).toISOString(), durationMinutes: 60 })).status).toBe(400);
    const s = await a.post('/api/sessions', { title: 'Future', startsAt: future(), durationMinutes: 60 });
    expect((await a.post(`/api/sessions/${s.body.id}/check-in`)).status).toBe(400);
  });

  it('sends each reminder once', async () => {
    const a = await student();
    await a.post('/api/sessions', { title: 'Soon', startsAt: future(0.5), durationMinutes: 30 });
    await sendReminders(); await sendReminders();
    const reminders = (await a.get('/api/notifications')).body.items.filter((n: { title: string }) => n.title.startsWith('Starting soon'));
    expect(reminders).toHaveLength(1);
  });
});

describe('resources and file security', () => {
  it('rejects disguised and oversized files', async () => {
    const a = await student();
    const fake = await a.upload('/api/resources', 'file', Buffer.from('MZ\x90binary'), 'notes.pdf', { title: 'Bad' });
    expect(fake.status).toBe(400);
    const big = await a.upload('/api/resources', 'file', Buffer.alloc(2 * 1024 * 1024, 0x25), 'big.pdf', { title: 'Big' });
    expect(big.status).toBe(413);
  });

  it('restricts group files to group members and forces download', async () => {
    const owner = await student(); const member = await student(); const outsider = await student();
    const groupId = await groupWith(owner, member);
    const created = await owner.upload('/api/resources', 'file', PDF, '../../evil name.pdf', { title: 'Notes', groupId, tags: 'exam,notes', subject: 'Algorithms' });
    expect(created.status).toBe(201);
    const list = await member.get(`/api/resources?groupId=${groupId}&tags=exam`);
    expect(list.body.items[0].fileName).toBe('evil name.pdf');
    const download = await member.get(`/api/files/${list.body.items[0].fileId}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((await outsider.get(`/api/files/${list.body.items[0].fileId}`)).status).toBe(403);
    expect((await outsider.get(`/api/resources?groupId=${groupId}`)).body.total).toBe(0);
  });

  it('refuses javascript: links', async () => {
    const a = await student();
    const res = await a.agent.post('/api/resources').set('x-csrf-token', a.csrf).field('title', 'x').field('url', 'javascript:alert(1)');
    expect(res.status).toBe(422);
  });
});

describe('teacher verification and permissions', () => {
  it('keeps a pending teacher away from approved-teacher features', async () => {
    const t = await pendingTeacher();
    expect((await t.get('/api/teacher/dashboard')).body.approved).toBe(false);
    expect((await t.get('/api/teacher/analytics')).status).toBe(403);
    expect((await t.post('/api/groups', { name: 'X' })).status).toBe(403);
    expect((await t.get('/api/students')).status).toBe(403);
  });

  it('grants access only after an administrator approves', async () => {
    const t = await pendingTeacher();
    const queue = await adminUser.get('/api/admin/verifications');
    expect(queue.body.items.some((v: { teacherId: string }) => v.teacherId === t.id)).toBe(true);
    expect((await adminUser.patch(`/api/admin/teachers/${t.id}/verification`, { status: 'needs_info' })).status).toBe(400);
    await adminUser.patch(`/api/admin/teachers/${t.id}/verification`, { status: 'needs_info', note: 'Send your ID' });
    expect((await t.post('/api/groups', { name: 'X' })).status).toBe(403);
    await adminUser.patch(`/api/admin/teachers/${t.id}/verification`, { status: 'approved' });
    const group = await t.post('/api/groups', { name: 'Maths Community', kind: 'community' });
    expect(group.status).toBe(201);
  });

  it('protects verification documents', async () => {
    const t = await pendingTeacher(); const s = await student();
    const res = await t.upload('/api/teacher/verification', 'file', PDF, 'id.pdf', { statement: 'My ID' });
    expect(res.status).toBe(201);
    const file = (await q(`SELECT id FROM files WHERE owner_id = $1 AND purpose = 'verification'`, [t.id]))[0];
    expect((await s.get(`/api/files/${file.id}`)).status).toBe(403);
    expect((await adminUser.get(`/api/files/${file.id}`)).status).toBe(200);
  });

  it('stops students creating communities and reaching teacher routes', async () => {
    const s = await student();
    expect((await s.post('/api/groups', { name: 'C', kind: 'community' })).status).toBe(403);
    expect((await s.get('/api/teacher/analytics')).status).toBe(403);
    expect((await s.post('/api/assignments', { title: 'x', dueAt: future(), groupId: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
  });

  it('keeps teachers and students out of administrator routes', async () => {
    const t = await approvedTeacher(adminUser); const s = await student();
    for (const c of [t, s]) {
      expect((await c.get('/api/admin/dashboard')).status).toBe(403);
      expect((await c.patch(`/api/admin/users/${s.id}/status`, { status: 'suspended' })).status).toBe(403);
    }
  });

  it('requires a session for protected routes', async () => {
    expect((await request(app).get('/api/users/me')).status).toBe(401);
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  it('does not give teachers access to private student conversations', async () => {
    const t = await approvedTeacher(adminUser); const a = await student(); const b = await student();
    await connect(a, b);
    const convo = await a.post('/api/conversations', { userId: b.id });
    expect((await t.get(`/api/conversations/${convo.body.id}/messages`)).status).toBe(404);
  });
});

describe('mentorship and assignments', () => {
  it('runs request, accept, session and feedback', async () => {
    const t = await approvedTeacher(adminUser); const s = await student();
    const req = await s.post('/api/mentorship/requests', { teacherId: t.id, objective: 'Learn graphs', topics: ['Graphs'] });
    expect(req.status).toBe(201);
    expect((await s.post('/api/mentorship/requests', { teacherId: t.id, objective: 'Again' })).status).toBe(409);
    expect((await s.patch(`/api/mentorship/requests/${req.body.id}`, { action: 'accept' })).status).toBe(403);
    expect((await t.patch(`/api/mentorship/requests/${req.body.id}`, { action: 'accept' })).status).toBe(200);
    const session = await t.post('/api/sessions', { title: 'Mentoring', startsAt: future(), durationMinutes: 45, mentorshipId: req.body.id });
    expect(session.status).toBe(201);
    expect((await s.get('/api/sessions')).body.items[0].joined).toBe(true);
    await t.post(`/api/mentorship/${req.body.id}/feedback`, { body: 'Good progress' });
    expect((await s.get('/api/mentorship')).body.items[0].feedback[0].body).toBe('Good progress');
  });

  it('refuses mentorship with unapproved teachers', async () => {
    const t = await pendingTeacher(); const s = await student();
    expect((await s.post('/api/mentorship/requests', { teacherId: t.id, objective: 'x' })).status).toBe(404);
  });

  it('assigns, submits and reviews, within ownership limits', async () => {
    const t = await approvedTeacher(adminUser); const s = await student(); const other = await student();
    const groupId = await groupWith(t, s);
    const a = await t.post('/api/assignments', { title: 'Essay', dueAt: future(), groupId });
    expect(a.status).toBe(201);
    expect((await other.get(`/api/assignments/${a.body.id}`)).status).toBe(404);
    expect((await other.upload(`/api/assignments/${a.body.id}/submission`, 'file', PDF, 'a.pdf')).status).toBe(404);
    const sub = await s.upload(`/api/assignments/${a.body.id}/submission`, 'file', PDF, 'essay.pdf', { body: 'done' });
    expect(sub.status).toBe(201);
    const detail = await t.get(`/api/assignments/${a.body.id}`);
    expect(detail.body.submissions).toHaveLength(1);
    expect((await t.get(`/api/files/${detail.body.submissions[0].fileId}`)).status).toBe(200);
    const stranger = await approvedTeacher(adminUser);
    expect((await stranger.patch(`/api/submissions/${sub.body.id}`, { status: 'completed' })).status).toBe(404);
    await t.patch(`/api/submissions/${sub.body.id}`, { status: 'completed', feedback: 'Well argued' });
    const mine = await s.get(`/api/assignments/${a.body.id}`);
    expect(mine.body.submissions[0].feedback).toBe('Well argued');
    expect((await s.upload(`/api/assignments/${a.body.id}/submission`, 'file', PDF, 'b.pdf')).status).toBe(409);
  });

  it('refuses to assign to groups the teacher does not belong to', async () => {
    const t = await approvedTeacher(adminUser); const s = await student(); const other = await student();
    const groupId = await groupWith(s);
    expect((await t.post('/api/assignments', { title: 'x', dueAt: future(), groupId })).status).toBe(403);
    expect((await t.post('/api/assignments', { title: 'x', dueAt: future(), studentIds: [other.id] })).status).toBe(403);
  });
});

describe('notifications', () => {
  it('counts, marks read and only touches your own', async () => {
    const a = await student(); const b = await student();
    await a.post('/api/connections', { userId: b.id });
    expect((await b.get('/api/notifications/unread-count')).body.count).toBe(1);
    const id = (await b.get('/api/notifications')).body.items[0].id;
    expect((await a.patch(`/api/notifications/${id}/read`)).status).toBe(404);
    await b.patch(`/api/notifications/${id}/read`);
    expect((await b.get('/api/notifications/unread-count')).body.count).toBe(0);
  });

  it('honours muted types and email opt-in', async () => {
    const a = await student(); const b = await student();
    await b.patch('/api/users/me/preferences', { mutedTypes: ['connection_request'], emailTypes: [] });
    await a.post('/api/connections', { userId: b.id });
    expect((await b.get('/api/notifications/unread-count')).body.count).toBe(0);
  });
});

describe('administration', () => {
  it('suspends: ends sessions, blocks login, and reactivates', async () => {
    const s = await student();
    expect((await adminUser.patch(`/api/admin/users/${s.id}/status`, { status: 'suspended', reason: 'Test' })).status).toBe(200);
    expect((await s.get('/api/auth/me')).status).toBe(401);
    const login = await new Client().login(s.email);
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await adminUser.patch(`/api/admin/users/${s.id}/status`, { status: 'active' });
    expect((await new Client().login(s.email)).status).toBe(200);
  });

  it('records administrative actions in the audit log', async () => {
    const s = await student();
    await adminUser.patch(`/api/admin/users/${s.id}/status`, { status: 'suspended' });
    const log = await adminUser.get('/api/admin/audit?pageSize=5');
    expect(log.body.items.some((e: { action: string; targetId: string }) => e.action === 'user.suspended' && e.targetId === s.id)).toBe(true);
  });

  it('moderates reports with history', async () => {
    const a = await student(); const b = await student();
    const report = await a.post('/api/reports', { targetType: 'user', targetId: b.id, reason: 'Spam' });
    await adminUser.patch(`/api/admin/reports/${report.body.id}`, { status: 'resolved', note: 'Warned' });
    const list = await adminUser.get('/api/admin/reports?status=resolved');
    expect(list.body.items.find((r: { id: string }) => r.id === report.body.id).history[0].note).toBe('Warned');
  });

  it('closes registration and exposes no secrets in system info', async () => {
    await adminUser.patch('/api/admin/settings', { registration_open: false });
    const res = await request(app).post('/api/auth/register').send({ fullName: 'X', email: uniqueEmail(), password: PASSWORD, role: 'student' });
    expect(res.status).toBe(403);
    await adminUser.patch('/api/admin/settings', { registration_open: true });
    const info = JSON.stringify((await adminUser.get('/api/admin/system')).body);
    expect(info).not.toContain(process.env.TEST_DATABASE_URL);
  });
});

describe('platform behaviour', () => {
  it('reports health without internals, accepts support requests, returns JSON 404s', async () => {
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).post('/api/support').send({ name: 'A', email: 'a@b.co', category: 'problem', message: 'Help' })).status).toBe(201);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });

  it('treats SQL metacharacters as data', async () => {
    const a = await student();
    const res = await a.get(`/api/groups?q=${encodeURIComponent(`'; DROP TABLE users; --`)}`);
    expect(res.status).toBe(200);
    expect((await pool.query('SELECT count(*) FROM users')).rows[0].count).not.toBe('0');
  });

  it('degrades gracefully when AI is not configured', async () => {
    const a = await student();
    expect((await a.get('/api/ai/status')).body.available).toBe(false);
    const res = await a.post('/api/ai/assist', { feature: 'question', input: 'What is recursion?' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
