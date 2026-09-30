import { hashPassword } from './auth.js';
import { pool } from './db.js';

const [login, password, admin = '', fullName = ''] = process.argv.slice(2);
const setsAdmin = admin === 'admin';

if (!login || !password) {
  console.error('Usage: npm run create-user -- <login> <password> [admin] ["Full name"]');
  process.exit(1);
}
if (admin && admin !== 'admin') {
  console.error('The third argument is either the word admin or nothing at all.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const hash = await hashPassword(password);
const res = await pool.query<{ login: string; is_admin: boolean }>(
  `insert into users (login, password_hash, is_admin, full_name)
   values ($1, $2, $3, $4)
   on conflict (login) do update
      set password_hash = excluded.password_hash,
          is_admin = case when $5 then excluded.is_admin else users.is_admin end,
          full_name = case when excluded.full_name = '' then users.full_name else excluded.full_name end,
          active = true
   returning login, is_admin`,
  [login, hash, setsAdmin, fullName, setsAdmin]
);

console.log(`Ready: ${res.rows[0].login}${res.rows[0].is_admin ? ' (admin)' : ''}`);
await pool.end();
