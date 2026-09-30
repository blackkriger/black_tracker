alter table issue_comments add column if not exists pinned_at timestamptz;
alter table issue_comments add column if not exists pinned_by uuid references users (id) on delete set null;
