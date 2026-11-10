import { migrate, pool } from '../db.js';

await migrate(console.log);
console.log('Migrations are up to date.');
await pool.end();
