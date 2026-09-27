-- Who was named in a comment, and whether they have seen it. The row is the mention; the
-- comment it hangs off carries the words, so deleting the comment takes the mention too.

create table if not exists mentions (
  comment_id uuid not null references issue_comments (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  primary key (comment_id, user_id)
);

-- The feed asks one question: what is waiting for me.
create index if not exists mentions_user_idx on mentions (user_id, read_at);
