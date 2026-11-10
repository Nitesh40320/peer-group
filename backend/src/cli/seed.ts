// Reference data only: the suggestion lists shown in topic pickers. Safe to run repeatedly.
import { pool, q } from '../db.js';

const TOPICS = {
  subject: ['Data Structures', 'Algorithms', 'Operating Systems', 'Database Systems', 'Computer Networks', 'Machine Learning', 'Linear Algebra', 'Calculus', 'Statistics', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Accounting', 'Marketing', 'Thermodynamics', 'Digital Electronics', 'English Literature'],
  skill: ['Python', 'Java', 'C++', 'JavaScript', 'SQL', 'React', 'MATLAB', 'Excel', 'Technical Writing', 'Public Speaking', 'Data Analysis', 'Git'],
  interest: ['Competitive Programming', 'Open Source', 'Robotics', 'Research', 'Startups', 'Hackathons', 'Web Development', 'Artificial Intelligence', 'Sustainability', 'Finance'],
};

for (const [kind, names] of Object.entries(TOPICS)) {
  await q('INSERT INTO topics (kind, name) SELECT $1, unnest($2::text[]) ON CONFLICT (kind, lower(name)) DO NOTHING', [kind, names]);
}
console.log('Reference topics are in place.');
await pool.end();
