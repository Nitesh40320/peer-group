import fs from 'node:fs';
import { expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { adminFile } from './global-setup';

export const PASSWORD = 'correct-horse-42';
const BASE = 'http://localhost:4100';
let counter = 0;
export const unique = (label: string) => `${label}.${Date.now()}.${++counter}`;
export const email = (label: string) => `${unique(label)}@example.test`;

export async function mailLink(api: APIRequestContext, to: string, marker: string) {
  await expect.poll(async () => (await (await api.get(`/api/dev/outbox?email=${encodeURIComponent(to)}`)).json()).items.filter((m: { text: string }) => m.text.includes(marker)).length).toBeGreaterThan(0);
  const { items } = await (await api.get(`/api/dev/outbox?email=${encodeURIComponent(to)}`)).json();
  const mail = items.filter((m: { text: string }) => m.text.includes(marker)).at(-1);
  return mail.text.match(/https?:\/\/\S+/)[0] as string;
}

export interface ApiUser { api: APIRequestContext; id: string; csrf: string; email: string; name: string }

/** Creates a verified, signed-in account through the real API, for supporting actors. */
export async function apiUser(role: 'student' | 'teacher', name: string): Promise<ApiUser> {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const address = email(role);
  const extra = role === 'teacher' ? { institution: 'State University', department: 'Computing', designation: 'Lecturer', statement: 'I teach algorithms.' } : {};
  expect((await api.post('/api/auth/register', { data: { fullName: name, email: address, password: PASSWORD, role, ...extra } })).status()).toBe(202);
  const link = await mailLink(api, address, 'verify-email');
  await api.post('/api/auth/verify-email', { data: { token: new URL(link).searchParams.get('token') } });
  const login = await (await api.post('/api/auth/login', { data: { email: address, password: PASSWORD } })).json();
  return { api, id: login.user.id, csrf: login.csrfToken, email: address, name };
}

export const adminCredentials = (): { email: string; password: string } => JSON.parse(fs.readFileSync(adminFile, 'utf8'));

async function apiAdmin() {
  const creds = adminCredentials();
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await (await api.post('/api/auth/login', { data: creds })).json();
  return { api, csrf: login.csrfToken, id: login.user.id };
}

export async function approvedTeacher(name: string) {
  const teacher = await apiUser('teacher', name);
  const admin = await apiAdmin();
  await admin.api.patch(`/api/admin/teachers/${teacher.id}/verification`, { data: { status: 'approved' }, headers: { 'x-csrf-token': admin.csrf } });
  return teacher;
}

export const call = (u: ApiUser, method: 'post' | 'patch', url: string, data: object = {}) => u.api[method](url, { data, headers: { 'x-csrf-token': u.csrf } });

export async function signIn(page: Page, address: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function signedInPage(browser: Browser, user: { email: string }, password = PASSWORD) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, user.email, password);
  await page.waitForURL(/\/(app|admin)/);
  return page;
}

export const dialog = (page: Page) => page.getByRole('dialog');
export const toast = (page: Page, text: string | RegExp) => expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();
