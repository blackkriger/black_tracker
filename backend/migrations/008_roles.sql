-- Roles: rows people create, not an enum in code. A role is what someone is called on the team — dev, artist, game designer — and it carries a colour the way a tag does. `users.is_admin` stays what it always was: the right to change how the tracker is set up, held regardless of the role someone wears.

create table if not exists roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists roles_name_idx on roles (lower(name));

-- A deleted role leaves nobody stranded: the people wearing it simply stop wearing one.
alter table users add column if not exists role_id uuid references roles (id) on delete set null;
alter table invites add column if not exists role_id uuid references roles (id) on delete set null;
