// Optional sample accounts for trying the app locally. Refuses to run in production.
// Usage: DEMO_PASSWORD=<10+ characters with a letter and number> npm run db:seed:demo
import { config } from '../config.js';
import { one, pool, q } from '../db.js';
import { hashPassword, passwordSchema } from '../modules/auth.js';
import { topicIds } from '../modules/people.js';

if (config.isProduction) {
  console.error('Demo data cannot be created in production.');
  process.exit(1);
}
const password = passwordSchema.safeParse(process.env.DEMO_PASSWORD ?? '');
if (!password.success) {
  console.error('Set DEMO_PASSWORD to at least 10 characters with a letter and a number.');
  process.exit(1);
}
const hash = await hashPassword(password.data);

async function account(email: string, name: string, role: string) {
  const row = await one(`INSERT INTO users (email, password_hash, full_name, role, email_verified_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (email) DO NOTHING RETURNING id`, [email, hash, name, role]);
  if (row) await q('INSERT INTO notification_preferences (user_id) VALUES ($1)', [row.id]);
  return row?.id as string | undefined;
}

async function student(email: string, name: string, year: number, topics: { subjects: string[]; skills: string[]; interests: string[] }, availability: string[], goals: string) {
  const id = await account(email, name, 'student');
  if (!id) return;
  await q(`INSERT INTO student_profiles (user_id, institution, department, academic_year, learning_goals, learning_methods, availability) VALUES ($1, 'Demo University', 'Computer Science', $2, $3, '{discussion,problem_solving}', $4)`, [id, year, goals, availability]);
  const ids = [...await topicIds('subject', topics.subjects), ...await topicIds('skill', topics.skills), ...await topicIds('interest', topics.interests)];
  await q('INSERT INTO user_topics (user_id, topic_id) SELECT $1, unnest($2::uuid[])', [id, ids]);
}

await account('admin@demo.peerconnect.test', 'Demo Administrator', 'admin');
const teacher = await account('teacher@demo.peerconnect.test', 'Demo Teacher', 'teacher');
if (teacher) {
  await q(`INSERT INTO teacher_profiles (user_id, institution, department, designation, verification_status) VALUES ($1, 'Demo University', 'Computer Science', 'Lecturer', 'approved')`, [teacher]);
  await q(`INSERT INTO teacher_verifications (teacher_id, statement, status, decided_at) VALUES ($1, 'Demo account', 'approved', now())`, [teacher]);
}
await student('student1@demo.peerconnect.test', 'Demo Student One', 2, { subjects: ['Data Structures', 'Algorithms'], skills: ['Python'], interests: ['Competitive Programming'] }, ['mon_evening', 'wed_evening'], 'Prepare for coding interviews');
await student('student2@demo.peerconnect.test', 'Demo Student Two', 2, { subjects: ['Data Structures', 'Database Systems'], skills: ['SQL'], interests: ['Competitive Programming'] }, ['mon_evening', 'sat_morning'], 'Prepare for coding interviews and exams');

console.log('Demo accounts are ready (admin@, teacher@, student1@, student2@demo.peerconnect.test).');
await pool.end();
