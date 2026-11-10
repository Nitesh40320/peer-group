import { expect, test, type Page } from '@playwright/test';
import { adminCredentials, apiUser, approvedTeacher, call, signIn, unique, type ApiUser } from './helpers';

const WIDTHS = [360, 390, 768, 1024, 1440];

async function audit(page: Page, label: string, problems: string[]) {
  await page.waitForLoadState('networkidle');
  const result = await page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const name = (e: Element) => (e.getAttribute('aria-label') || (e as HTMLInputElement).labels?.[0]?.textContent || e.textContent || e.getAttribute('title') || '').trim();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      unnamed: [...document.querySelectorAll('a, button, input:not([type=hidden]), select, textarea')].filter((e) => visible(e) && !name(e) && !e.querySelector('[aria-label]')).map((e) => e.outerHTML.slice(0, 80)),
      noH1: document.querySelectorAll('h1').length !== 1,
      imagesNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      smallTargets: [...document.querySelectorAll('.btn, .icon-btn, .nav-link, .tab')].filter((e) => visible(e) && e.getBoundingClientRect().height < 40).map((e) => (e.textContent ?? '').slice(0, 30)),
    };
  });
  if (result.overflow > 0) problems.push(`${label}: horizontal overflow ${result.overflow}px`);
  if (result.unnamed.length) problems.push(`${label}: unnamed controls ${result.unnamed.join(' | ')}`);
  if (result.noH1) problems.push(`${label}: expected exactly one h1`);
  if (result.imagesNoAlt) problems.push(`${label}: images without alt`);
  if (result.smallTargets.length) problems.push(`${label}: small targets ${result.smallTargets.join(' | ')}`);
}

async function sweep(page: Page, routes: string[], problems: string[], errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of routes) {
      await page.goto(route);
      await audit(page, `${route}@${width}`, problems);
    }
  }
}

let student: ApiUser;
let groupPath = '';
let projectPath = '';

test.beforeAll(async () => {
  student = await apiUser('student', 'Quality Student');
  await call(student, 'patch', '/api/users/me', { subjects: ['Long Subject Name For Layout Testing'], institution: 'University of Somewhere Very Long Indeed' });
  const group = await (await call(student, 'post', '/api/groups', { name: unique('A deliberately long study group name to test wrapping'), subjects: ['Algorithms'] })).json();
  groupPath = `/app/groups/${group.id}`;
  const project = await (await call(student, 'post', '/api/projects', { groupId: group.id, title: 'Layout project' })).json();
  projectPath = `/app/projects/${project.id}`;
  await call(student, 'post', `/api/projects/${project.id}/tasks`, { title: 'A task with a reasonably long title for the board' });
});

test('public pages are responsive and accessible', async ({ page }) => {
  const problems: string[] = []; const errors: string[] = [];
  await sweep(page, ['/', '/help', '/terms', '/privacy', '/login', '/register', '/forgot-password'], problems, errors);
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('student screens are responsive and accessible', async ({ page }) => {
  await signIn(page, student.email);
  await page.waitForURL(/\/app/);
  const problems: string[] = []; const errors: string[] = [];
  await sweep(page, ['/app', '/app/profile', '/app/settings', '/app/discover', '/app/connections', '/app/groups', groupPath, `${groupPath}?tab=tasks`, `${groupPath}?tab=members`, projectPath, '/app/messages', '/app/sessions', '/app/resources', '/app/assignments', '/app/mentorship', '/app/progress', '/app/assistant', '/app/notifications'], problems, errors);
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('teacher screens are responsive and accessible', async ({ page }) => {
  const teacher = await approvedTeacher(unique('Dr Layout'));
  await signIn(page, teacher.email);
  await page.waitForURL(/\/app/);
  const problems: string[] = []; const errors: string[] = [];
  await sweep(page, ['/app', '/app/analytics', '/app/verification', '/app/assignments', '/app/mentorship', '/app/groups'], problems, errors);
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('admin screens are responsive and accessible', async ({ page }) => {
  const creds = adminCredentials();
  await signIn(page, creds.email, creds.password);
  await page.waitForURL(/\/admin/);
  const problems: string[] = []; const errors: string[] = [];
  await sweep(page, ['/admin', '/admin/users', '/admin/verifications', '/admin/reports', '/admin/support', '/admin/audit', '/admin/system'], problems, errors);
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('frontend routes enforce roles and old URLs redirect', async ({ page }) => {
  await signIn(page, student.email);
  await page.waitForURL(/\/app/);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/analytics');
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/login.html');
  await expect(page).toHaveURL(/\/app$/);
  const res = await page.request.get('/features.html', { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByText('We could not find that page.')).toBeVisible();
});

test('real-time messages arrive without a reload', async ({ browser }) => {
  const a = await apiUser('student', 'Ada Sender');
  const b = await apiUser('student', 'Bo Receiver');
  const req = await (await call(a, 'post', '/api/connections', { userId: b.id })).json();
  await call(b, 'patch', `/api/connections/${req.id}`, { action: 'accept' });
  const convo = await (await call(a, 'post', '/api/conversations', { userId: b.id })).json();
  const page = await (await browser.newContext()).newPage();
  await signIn(page, b.email);
  await page.waitForURL(/\/app/);
  await page.goto(`/app/messages/${convo.id}`);
  await expect(page.getByText('No messages yet')).toBeVisible();
  await page.waitForTimeout(800);
  await a.api.post(`/api/conversations/${convo.id}/messages`, { multipart: { body: 'Live hello' }, headers: { 'x-csrf-token': a.csrf } });
  await expect(page.getByText('Live hello')).toBeVisible();
});

test('content is escaped when rendered', async ({ browser }) => {
  const a = await apiUser('student', '<img src=x onerror="window.__xss=1">');
  const group = await (await call(a, 'post', '/api/groups', { name: '<script>window.__xss=1</script>', description: '<img src=x onerror="window.__xss=1">' })).json();
  const page = await (await browser.newContext()).newPage();
  await signIn(page, a.email);
  await page.waitForURL(/\/app/);
  await page.goto(`/app/groups/${group.id}`);
  await expect(page.getByRole('heading', { name: '<script>window.__xss=1</script>' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});
