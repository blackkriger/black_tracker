alter table sessions add column if not exists id uuid not null default gen_random_uuid();
alter table sessions add column if not exists user_agent text;
alter table sessions add column if not exists last_seen_at timestamptz;
create unique index if not exists sessions_id_idx on sessions (id);

alter table users add column if not exists github_login text;
create unique index if not exists users_github_login_idx on users (lower(github_login));
