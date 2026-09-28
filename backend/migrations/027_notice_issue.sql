-- A notice need not be about a comment: being handed an issue is about the issue itself.
-- The column is nullable because the older kinds still hang off a comment and take their
-- issue from it.

alter table notices add column if not exists issue_id uuid references issues (id) on delete cascade;

create index if not exists notices_issue_idx on notices (issue_id);
