create index if not exists board_denials_role_idx on board_denials (role_id);
create index if not exists project_denials_role_idx on project_denials (role_id);
create index if not exists issue_tags_tag_idx on issue_tags (tag_id);
