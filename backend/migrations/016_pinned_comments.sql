-- A comment can be pinned: the decision, the spec, the link everyone keeps scrolling back for. Pinned ones sit at the head of the thread and keep their place in it.

alter table issue_comments add column if not exists pinned_at timestamptz;
alter table issue_comments add column if not exists pinned_by uuid references users (id) on delete set null;
