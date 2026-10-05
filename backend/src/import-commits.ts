import { readFileSync } from 'node:fs';
import { recordCommits, type CommitEvent } from './commits.js';
import { pool } from './db.js';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run import-commits -- <events.json>');
  process.exit(1);
}

const events = JSON.parse(readFileSync(file, 'utf8')) as CommitEvent[];
const linked = await recordCommits(events);
console.log(`${events.length} commits read, ${linked.length} issues got new commits: ${linked.map((l) => l.issueKey).join(', ')}`);
await pool.end();
