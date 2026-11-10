// Periodic work: reminders and cleanup. Each claim is one UPDATE, so reminders are sent once
// even if several server instances run.
import { q } from './db.js';
import { reportError } from './lib/core.js';
import { notify } from './lib/services.js';

export async function sendReminders() {
  const sessions = await q(`UPDATE study_sessions SET reminded_at = now() WHERE status = 'scheduled' AND reminded_at IS NULL
    AND starts_at BETWEEN now() AND now() + interval '1 hour' RETURNING id, title, starts_at`);
  for (const s of sessions) {
    const people = await q('SELECT user_id FROM session_participants WHERE session_id = $1', [s.id]);
    await Promise.all(people.map((p) => notify(p.userId, 'session_reminder', { title: `Starting soon: ${s.title}`, body: `Starts ${new Date(s.startsAt).toUTCString()}`, link: '/app/sessions' })));
  }
  const assignments = await q(`UPDATE assignments SET reminded_at = now() WHERE status = 'active' AND reminded_at IS NULL
    AND due_at BETWEEN now() AND now() + interval '1 day' RETURNING id, title`);
  for (const a of assignments) {
    const people = await q(`SELECT r.student_id FROM assignment_recipients r LEFT JOIN submissions s ON s.assignment_id = r.assignment_id AND s.student_id = r.student_id WHERE r.assignment_id = $1 AND s.id IS NULL`, [a.id]);
    await Promise.all(people.map((p) => notify(p.studentId, 'assignment_deadline', { title: `Due within a day: ${a.title}`, link: `/app/assignments/${a.id}` })));
  }
  const tasks = await q(`UPDATE tasks SET reminded_at = now() WHERE status <> 'completed' AND reminded_at IS NULL AND assignee_id IS NOT NULL
    AND due_at BETWEEN now() AND now() + interval '1 day' RETURNING title, assignee_id, project_id, group_id`);
  await Promise.all(tasks.map((t) => notify(t.assigneeId, 'task_update', { title: `Task due within a day: ${t.title}`, link: t.projectId ? `/app/projects/${t.projectId}` : `/app/groups/${t.groupId}?tab=tasks` })));
}

async function cleanup() {
  await q('DELETE FROM sessions WHERE expires_at < now()');
  await q(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`);
}

export function startJobs() {
  const run = (fn: () => Promise<void>, name: string) => () => fn().catch((error) => reportError(error, { job: name }));
  const timers = [setInterval(run(sendReminders, 'reminders'), 60000), setInterval(run(cleanup, 'cleanup'), 60 * 60 * 1000)];
  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
