-- Two index corrections. A comment's files are looked up by comment_id on every comment delete and on every read of an issue, with nothing to stand on. And the index named issues_board_idx has never been about boards: migration 004 tried to create it over (board_id, state_id), but 001 had already taken the name for (project_id, state_id), so the statement did nothing and the name has lied ever since. The board query is served by issues_board_state_idx from 012; this only renames the old one to what it is.

create index if not exists issue_attachments_comment_idx on issue_attachments (comment_id);

alter index if exists issues_board_idx rename to issues_project_state_idx;
