-- One issue is related to another, and that is the whole statement: no kinds, no direction, no blocking. The pair is stored once with its ids in order, so a link cannot be made twice or made against itself.

create table if not exists issue_links (
  a          uuid not null references issues (id) on delete cascade,
  b          uuid not null references issues (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references users (id) on delete set null,
  primary key (a, b),
  check (a < b)
);

create index if not exists issue_links_b_idx on issue_links (b);
