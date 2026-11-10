import { expect, test } from '@playwright/test';
import { adminCredentials, apiUser, approvedTeacher, call, dialog, email, mailLink, PASSWORD, signIn, signedInPage, toast, unique } from './helpers';

test('A: student registers, verifies, completes profile, discovers and connects', async ({ page, request }) => {
  const partnerName = unique('Priya Partner');
  const other = await apiUser('student', partnerName);
  await call(other, 'patch', '/api/users/me', { subjects: ['Data Structures'], availability: ['mon_evening'], interests: ['Competitive Programming'] });

  const address = email('workflow-a');
  await page.goto('/');
  await page.getByRole('link', { name: 'Get Started' }).first().click();
  await page.getByLabel('Full name').fill('Asha Learner');
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await signIn(page, address);
  await expect(page.getByText('Verify your email before signing in.')).toBeVisible();

  await page.goto(await mailLink(request, address, 'verify-email'));
  await expect(page.getByText('Your email is verified.')).toBeVisible();

  await signIn(page, address);
  await expect(page.getByRole('heading', { name: 'Welcome, Asha' })).toBeVisible();

  await page.goto('/app/profile');
  await page.getByLabel('Subjects').fill('Data Structures');
  await page.getByLabel('Subjects').press('Enter');
  await page.getByLabel('Interests').fill('Competitive Programming');
  await page.getByLabel('Interests').press('Enter');
  await page.getByRole('checkbox', { name: 'Mon Evening' }).check({ force: true });
  await page.getByRole('button', { name: 'Save profile' }).click();
  await toast(page, 'Profile saved.');

  await page.goto('/app/discover');
  const card = page.getByRole('listitem').filter({ hasText: partnerName });
  await expect(card.getByText(/Recommended because you both study Data Structures/)).toBeVisible();
  await card.getByRole('button', { name: 'Connect' }).click();
  await toast(page, 'Connection request sent.');

  await expect.poll(async () => (await (await other.api.get('/api/connections')).json()).incoming.length).toBe(1);
  const { incoming } = await (await other.api.get('/api/connections')).json();
  await call(other, 'patch', `/api/connections/${incoming[0].id}`, { action: 'accept' });
  await page.goto('/app/connections');
  await expect(page.getByRole('link', { name: partnerName })).toBeVisible();
});

test('B: owner approves a join request and both reach the workspace', async ({ browser }) => {
  const owner = await apiUser('student', 'Olu Owner');
  const joiner = await apiUser('student', 'Jay Joiner');
  const name = unique('Graph Theory Circle');

  const ownerPage = await signedInPage(browser, owner);
  await ownerPage.goto('/app/groups');
  await ownerPage.getByRole('button', { name: 'Create group' }).click();
  await dialog(ownerPage).getByLabel('Group name').fill(name);
  await dialog(ownerPage).getByRole('button', { name: 'Create group' }).click();
  await expect(ownerPage.getByRole('heading', { name })).toBeVisible();
  await expect(ownerPage).toHaveURL(/\/app\/groups\/[0-9a-f-]+/);
  const groupUrl = new URL(ownerPage.url()).pathname;

  const joinerPage = await signedInPage(browser, joiner);
  await joinerPage.goto(groupUrl);
  await joinerPage.getByLabel('Message to the group (optional)').fill('I would like to join.');
  await joinerPage.getByRole('button', { name: 'Request to join' }).click();
  await expect(joinerPage.getByText('Your request is waiting')).toBeVisible();
  await expect(joinerPage.getByRole('tab', { name: 'Discussion' })).toHaveCount(0);

  await ownerPage.goto(`${groupUrl}?tab=members`);
  await ownerPage.getByRole('button', { name: 'Approve' }).click();
  await toast(ownerPage, 'Member added.');

  await joinerPage.goto(groupUrl);
  await expect(joinerPage.getByRole('tab', { name: 'Discussion' })).toBeVisible();
  await joinerPage.getByRole('tab', { name: 'Discussion' }).click();
  await joinerPage.getByLabel('Message', { exact: true }).fill('Hello team');
  await joinerPage.getByRole('button', { name: 'Send message' }).click();

  await ownerPage.goto(`${groupUrl}?tab=discussion`);
  await expect(ownerPage.getByText('Hello team')).toBeVisible();
});

test('C: students create a project, assign tasks, progress and complete milestones', async ({ browser }) => {
  const owner = await apiUser('student', 'Pat Lead');
  const teammate = await apiUser('student', 'Tess Mate');
  const group = await (await call(owner, 'post', '/api/groups', { name: unique('Compilers') })).json();
  await call(teammate, 'post', `/api/groups/${group.id}/join`, {});
  const requests = await (await owner.api.get(`/api/groups/${group.id}/requests`)).json();
  await call(owner, 'patch', `/api/groups/${group.id}/requests/${requests.items[0].id}`, { action: 'approve' });

  const page = await signedInPage(browser, owner);
  await page.goto(`/app/groups/${group.id}?tab=projects`);
  await page.getByRole('button', { name: 'New project' }).click();
  await dialog(page).getByLabel('Project title').fill('Toy compiler');
  await dialog(page).getByRole('checkbox', { name: 'Tess Mate' }).check();
  await dialog(page).getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Toy compiler' })).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  await dialog(page).getByLabel('Title').fill('Write the lexer');
  await dialog(page).getByLabel('Assign to').selectOption({ label: 'Tess Mate' });
  await dialog(page).getByRole('button', { name: 'Add task' }).click();
  await toast(page, 'Task added.');

  const teammatePage = await signedInPage(browser, teammate);
  await teammatePage.goto(new URL(page.url()).pathname);
  const status = teammatePage.getByLabel('Status of Write the lexer');
  for (const [value, column] of [['in_progress', 'In Progress'], ['review', 'Review'], ['completed', 'Completed']]) {
    await status.selectOption(value);
    await expect(teammatePage.getByRole('region', { name: column }).getByText('Write the lexer', { exact: true })).toBeVisible();
  }
  await expect(teammatePage.getByText('100% complete')).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await page.getByLabel('Milestone').fill('Parser ready');
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await toast(page, 'Milestone added.');
  await page.getByRole('checkbox', { name: /Parser ready/ }).check();
  await expect(page.getByRole('checkbox', { name: /Parser ready/ })).toBeChecked();
  await page.reload();
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await expect(page.getByRole('checkbox', { name: /Parser ready/ })).toBeChecked();
});

test('D: student requests mentorship, teacher accepts, a session is scheduled', async ({ browser }) => {
  const teacher = await approvedTeacher(unique('Dr Mentor'));
  const student = await apiUser('student', 'Mina Mentee');
  const studentPage = await signedInPage(browser, student);

  await studentPage.goto('/app/discover');
  await studentPage.getByRole('tab', { name: 'Teachers' }).click();
  await studentPage.getByLabel('Search teachers').fill(teacher.name);
  const card = studentPage.getByRole('listitem').filter({ hasText: teacher.name });
  await card.getByRole('button', { name: 'Request mentorship' }).click();
  await dialog(studentPage).getByLabel('Your academic objective').fill('Understand dynamic programming');
  await dialog(studentPage).getByRole('button', { name: 'Send request' }).click();
  await toast(studentPage, 'Mentorship request sent.');

  const teacherPage = await signedInPage(browser, teacher);
  await teacherPage.goto('/app/mentorship');
  await expect(teacherPage.getByText('Understand dynamic programming')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'Accept' }).click();
  await toast(teacherPage, 'Mentorship accepted.');

  await teacherPage.getByRole('button', { name: 'Schedule session' }).click();
  await dialog(teacherPage).getByLabel('Title').fill('First mentoring session');
  const tomorrow = new Date(Date.now() + 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await dialog(teacherPage).getByLabel('Date and time').fill(tomorrow);
  await dialog(teacherPage).getByRole('button', { name: 'Schedule', exact: true }).click();
  await toast(teacherPage, 'Session scheduled.');

  await studentPage.goto('/app/sessions');
  await expect(studentPage.getByText('First mentoring session')).toBeVisible();
  await studentPage.goto('/app/notifications');
  await expect(studentPage.getByRole('button', { name: /New session: First mentoring session/ })).toBeVisible();
});

test('E: teacher registers, admin approves, teacher creates an academic group', async ({ browser, page, request }) => {
  const address = email('workflow-e');
  const teacherName = unique('Prof Newcomer');
  await page.goto('/register?role=teacher');
  await page.getByLabel('Full name').fill(teacherName);
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByLabel('Institution').fill('City College');
  await page.getByLabel('Department').fill('Mathematics');
  await page.getByLabel('Designation').fill('Professor');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await mailLink(request, address, 'verify-email'));
  await expect(page.getByText('Your email is verified.')).toBeVisible();

  await signIn(page, address);
  await expect(page.getByText(/Teaching features unlock once an administrator approves it/)).toBeVisible();
  await page.goto('/app/groups');
  await expect(page).toHaveURL(/\/app$/);

  const adminPage = await signedInPage(browser, adminCredentials(), adminCredentials().password);
  await adminPage.goto('/admin/verifications');
  const item = adminPage.getByRole('listitem').filter({ hasText: teacherName });
  await item.getByRole('button', { name: 'Approve' }).click();
  await dialog(adminPage).getByRole('button', { name: 'Confirm' }).click();
  await toast(adminPage, 'Decision recorded.');

  await page.goto('/app/groups');
  await page.getByRole('button', { name: 'Create group' }).click();
  await dialog(page).getByLabel('Type').selectOption('community');
  const name = unique('Maths Community');
  await dialog(page).getByLabel('Group name').fill(name);
  await dialog(page).getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('F: suspended account loses access immediately', async ({ browser }) => {
  const student = await apiUser('student', unique('Sam Suspended'));
  const studentPage = await signedInPage(browser, student);
  await expect(studentPage.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  const adminPage = await signedInPage(browser, adminCredentials(), adminCredentials().password);
  await adminPage.goto('/admin/users');
  await adminPage.getByLabel('Search name or email').fill(student.email);
  await expect(adminPage.getByRole('row').filter({ hasText: student.email })).toBeVisible();
  await adminPage.getByRole('row').filter({ hasText: student.email }).getByRole('button', { name: 'Suspend', exact: true }).click();
  await dialog(adminPage).getByLabel('Reason').fill('Workflow test');
  await dialog(adminPage).getByRole('button', { name: 'Suspend account' }).click();
  await toast(adminPage, 'Account suspended.');

  await studentPage.goto('/app/groups');
  await expect(studentPage).toHaveURL(/\/login/);
  await signIn(studentPage, student.email);
  await expect(studentPage.getByText('This account has been suspended')).toBeVisible();
  expect((await student.api.get('/api/users/me')).status()).toBe(401);
});
