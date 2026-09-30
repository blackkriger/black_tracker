create index if not exists issue_attachments_comment_idx on issue_attachments (comment_id);

alter index if exists issues_board_idx rename to issues_project_state_idx;
