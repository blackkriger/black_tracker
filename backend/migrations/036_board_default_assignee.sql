alter table boards add column if not exists default_assignee_id uuid references users (id) on delete set null;
