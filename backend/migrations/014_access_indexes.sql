-- Three lookups that run on nearly every request had no index to stand on: both denial tables are read by role alone, though their primary keys lead with the board or the project, and the tag list counts issues per tag through a join table indexed only by issue.

create index if not exists board_denials_role_idx on board_denials (role_id);
create index if not exists project_denials_role_idx on project_denials (role_id);
create index if not exists issue_tags_tag_idx on issue_tags (tag_id);
