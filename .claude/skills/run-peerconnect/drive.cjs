const { createRequire } = require('node:module');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../..') + '/';
const { chromium, request } = createRequire(repo + 'package.json')('@playwright/test');
const out = (process.env.OUT || require('node:os').tmpdir()) + '/';
const BASE = 'http://localhost:5173';

(async () => {
  const errors = [];
  const browser = await chromium.launch({ channel: process.env.CH || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  console.log('landing title:', await page.title());
  await page.screenshot({ path: out + '1-landing.png' });

  // Real account through the API, verified via the dev outbox.
  const api = await request.newContext({ baseURL: BASE });
  const email = `run.${Date.now()}@example.test`, password = 'correct-horse-42';
  console.log('register:', (await api.post('/api/auth/register', { data: { fullName: 'Run Smoke', email, password, role: 'student' } })).status());
  let link;
  for (let i = 0; i < 20 && !link; i++) {
    const { items } = await (await api.get('/api/dev/outbox?email=' + encodeURIComponent(email))).json();
    link = items.map((m) => m.text).find((t) => t.includes('verify-email'))?.match(/https?:\/\/\S+/)[0];
    if (!link) await new Promise((r) => setTimeout(r, 300));
  }
  console.log('verify:', (await api.post('/api/auth/verify-email', { data: { token: new URL(link).searchParams.get('token') } })).status());

  await page.goto(BASE + '/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app/);
  await page.waitForLoadState('networkidle');
  console.log('after login:', page.url(), '|', await page.title());
  await page.screenshot({ path: out + '2-dashboard.png' });

  await page.goto(BASE + '/app/groups');
  await page.waitForLoadState('networkidle');
  console.log('groups:', await page.title());
  await page.screenshot({ path: out + '3-groups.png' });

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
