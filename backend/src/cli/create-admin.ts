// Administrators can only be created from the command line, never through the application.
// Usage: npm run admin:create -- admin@example.com "Full Name"
// The password comes from the ADMIN_PASSWORD environment variable, so it stays out of shell history.
import { one, pool, q } from '../db.js';
import { emailSchema, hashPassword, passwordSchema } from '../modules/auth.js';

const [emailArg, name] = process.argv.slice(2);
const email = emailSchema.safeParse(emailArg ?? '');
const password = passwordSchema.safeParse(process.env.ADMIN_PASSWORD ?? '');

if (!email.success || !name || !password.success) {
  console.error('Usage: ADMIN_PASSWORD=<10+ characters with a letter and number> npm run admin:create -- <email> "<full name>"');
  process.exit(1);
}

if (await one('SELECT 1 AS x FROM users WHERE email = $1', [email.data])) {
  console.error('An account with that email already exists.');
  process.exit(1);
}

await q(`INSERT INTO users (email, password_hash, full_name, role, email_verified_at) VALUES ($1, $2, $3, 'admin', now())`, [email.data, await hashPassword(password.data), name]);
console.log(`Administrator ${email.data} created.`);
await pool.end();
