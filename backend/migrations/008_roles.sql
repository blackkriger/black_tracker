create table if not exists roles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists roles_name_idx on roles (lower(name));

alter table users add column if not exists role_id uuid references roles (id) on delete set null;
alter table invites add column if not exists role_id uuid references roles (id) on delete set null;
