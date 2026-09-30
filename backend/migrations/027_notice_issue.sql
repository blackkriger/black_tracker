alter table notices add column if not exists issue_id uuid references issues (id) on delete cascade;

create index if not exists notices_issue_idx on notices (issue_id);
