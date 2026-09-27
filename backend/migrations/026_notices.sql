-- Everything a person is told about, in one place: being named in a comment, and someone
-- reacting to what they wrote. The notice is the telling; the thing it is about lives
-- elsewhere and takes the notice with it when it goes.

create table if not exists comment_reactions (
  comment_id uuid not null references issue_comments (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);

create table if not exists notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  kind       text not null,
  comment_id uuid references issue_comments (id) on delete cascade,
  by_id      uuid references users (id) on delete set null,
  detail     text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- A name in a comment is one notice however many times the comment is edited.
create unique index if not exists notices_mention_idx
  on notices (comment_id, user_id) where kind = 'mention';
-- A reaction is one notice per person per emoji.
create unique index if not exists notices_reaction_idx
  on notices (comment_id, user_id, by_id, detail) where kind = 'reaction';
create index if not exists notices_user_idx on notices (user_id, read_at);

insert into notices (user_id, kind, comment_id, by_id, created_at, read_at)
select m.user_id, 'mention', m.comment_id, c.author_id, m.created_at, m.read_at
  from mentions m join issue_comments c on c.id = m.comment_id
on conflict do nothing;

drop table if exists mentions;
