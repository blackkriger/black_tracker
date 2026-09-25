// Accounts are made here, not through a sign-up form: `npm run create-user -- <login> <password> [admin|member] ["Full name"]`. It is also the only way to get the first admin in, and it doubles as a password reset when the login already exists.

import { hashPassword } from './auth.js';
import { pool } from './db.js';

const [login, password, role = 'member', fullName = ''] = process.argv.slice(2);

if (!login || !password) {
  console.error('Usage: npm run create-user -- <login> <password> [admin|member] ["Full name"]');
  process.exit(1);
}
if (role !== 'admin' && role !== 'member') {
  console.error('Role must be admin or member.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const hash = await hashPassword(password);
const res = await pool.query<{ login: string; role: string }>(
  `insert into users (login, password_hash, role, full_name)
   values ($1, $2, $3, $4)
   on conflict (login) do update
      set password_hash = excluded.password_hash,
          role = excluded.role,
          full_name = case when excluded.full_name = '' then users.full_name else excluded.full_name end,
          active = true
   returning login, role`,
  [login, hash, role, fullName]
);

console.log(`Ready: ${res.rows[0].login} (${res.rows[0].role})`);
await pool.end();
