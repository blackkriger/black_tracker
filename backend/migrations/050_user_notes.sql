create table if not exists user_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  body       text not null default '',
  color      text not null default 'amber' check (color in ('amber', 'blue', 'green', 'pink', 'violet', 'plain')),
  position   int not null default 0,
  height     int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_notes_user_idx on user_notes (user_id, position, created_at);
