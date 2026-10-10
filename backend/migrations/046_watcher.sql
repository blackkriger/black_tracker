alter table issues add column if not exists watcher_id uuid references users (id) on delete set null;
create index if not exists issues_watcher_idx on issues (watcher_id);
