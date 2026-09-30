create table if not exists invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  hint       text not null default '',
  is_admin   boolean not null default false,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references users (id)
);

create index if not exists invites_open_idx on invites (used_at, expires_at);
