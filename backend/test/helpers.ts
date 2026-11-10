import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate, pool, q } from '../src/db.js';
import { devOutbox } from '../src/lib/services.js';
import { hashPassword } from '../src/modules/auth.js';

export const app = createApp();
export const PASSWORD = 'correct-horse-42';

export async function resetDatabase() {
  await migrate();
  const tables = await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'platform_settings')`);
  await pool.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  // TRUNCATE ... CASCADE reaches platform_settings through its updated_by foreign key.
  await q(`INSERT INTO platform_settings (key, value) VALUES ('registration_open', 'true'), ('ai_enabled', 'true'), ('announcement_banner', '""')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  devOutbox.length = 0;
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${++counter}@example.test`;

export const tokenFrom = (email: string, path: string) => {
  const mail = devOutbox.filter((m) => m.to === email && m.text.includes(path)).at(-1);
  if (!mail) throw new Error(`No email for ${email} containing ${path}`);
  return new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
};

export class Client {
  agent = request.agent(app);
  csrf = '';
  id = '';
  email = '';

  private send(method: 'post' | 'patch' | 'delete', url: string, body?: object) {
    return this.agent[method](url).set('x-csrf-token', this.csrf).send(body);
  }
  get(url: string) { return this.agent.get(url); }
  post(url: string, body: object = {}) { return this.send('post', url, body); }
  patch(url: string, body: object = {}) { return this.send('patch', url, body); }
  delete(url: string) { return this.send('delete', url); }
  upload(url: string, field: string, data: Buffer, filename: string, fields: Record<string, string> = {}) {
    let r = this.agent.post(url).set('x-csrf-token', this.csrf).attach(field, data, filename);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  }
  async login(email = this.email, password = PASSWORD) {
    const res = await this.agent.post('/api/auth/login').send({ email, password });
    if (res.status === 200) { this.csrf = res.body.csrfToken; this.id = res.body.user.id; }
    return res;
  }
}

export async function register(role: 'student' | 'teacher', name = 'Test User') {
  const client = new Client();
  client.email = uniqueEmail(role);
  const extra = role === 'teacher' ? { institution: 'Test University', department: 'CS', designation: 'Lecturer', statement: 'I teach.' } : {};
  const res = await client.agent.post('/api/auth/register').send({ fullName: name, email: client.email, password: PASSWORD, role, ...extra });
  if (res.status !== 202) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return client;
}

export async function student(name = 'Student') {
  const client = await register('student', name);
  await client.agent.post('/api/auth/verify-email').send({ token: tokenFrom(client.email, 'verify-email') });
  await client.login();
  return client;
}

export async function admin() {
  const client = new Client();
  client.email = uniqueEmail('admin');
  await q(`INSERT INTO users (email, password_hash, full_name, role, email_verified_at) VALUES ($1, $2, 'Admin', 'admin', now())`, [client.email, await hashPassword(PASSWORD)]);
  await client.login();
  return client;
}

export async function pendingTeacher(name = 'Teacher') {
  const client = await register('teacher', name);
  await client.agent.post('/api/auth/verify-email').send({ token: tokenFrom(client.email, 'verify-email') });
  await client.login();
  return client;
}

export async function approvedTeacher(by: Client, name = 'Teacher') {
  const client = await pendingTeacher(name);
  await by.patch(`/api/admin/teachers/${client.id}/verification`, { status: 'approved' });
  return client;
}

export async function connect(a: Client, b: Client) {
  const req = await a.post('/api/connections', { userId: b.id });
  await b.patch(`/api/connections/${req.body.id}`, { action: 'accept' });
  return req.body.id as string;
}

export async function groupWith(owner: Client, member?: Client, overrides: object = {}) {
  const group = await owner.post('/api/groups', { name: 'Algorithms Circle', subjects: ['Algorithms'], ...overrides });
  if (member) {
    await member.post(`/api/groups/${group.body.id}/join`, {});
    const requests = await owner.get(`/api/groups/${group.body.id}/requests`);
    await owner.patch(`/api/groups/${group.body.id}/requests/${requests.body.items[0].id}`, { action: 'approve' });
  }
  return group.body.id as string;
}

export const future = (hours = 24) => new Date(Date.now() + hours * 3600000).toISOString();
export const PDF = Buffer.from('%PDF-1.7\nhello');
