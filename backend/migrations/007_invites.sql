-- Accounts still cannot be signed up for, but an admin no longer has to invent someone's password: they mint a link, and whoever opens it picks their own login and password. Only the hash of the link's token is kept, so a database dump is not a pile of working invitations.

create table if not exists invites (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  -- The tail of the token, so a link can be told apart in the list after its one showing.
  hint       text not null default '',
  -- What the account becomes when the link is used.
  is_admin   boolean not null default false,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references users (id)
);

create index if not exists invites_open_idx on invites (used_at, expires_at);
