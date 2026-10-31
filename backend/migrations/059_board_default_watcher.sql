alter table boards add column if not exists default_watcher_id uuid references users (id) on delete set null;
