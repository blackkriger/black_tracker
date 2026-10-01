alter table issue_links add column if not exists kind text not null default 'related';

alter table issue_links drop constraint if exists issue_links_check;
alter table issue_links drop constraint if exists issue_links_kind_check;
alter table issue_links drop constraint if exists issue_links_order_check;
alter table issue_links add constraint issue_links_kind_check check (kind in ('related', 'subtask', 'duplicate'));
alter table issue_links add constraint issue_links_order_check check (a <> b and (kind <> 'related' or a < b));

create unique index if not exists issue_links_pair_idx on issue_links (least(a, b), greatest(a, b));
create unique index if not exists issue_links_parent_idx on issue_links (b) where kind = 'subtask';
create unique index if not exists issue_links_original_idx on issue_links (a) where kind = 'duplicate';
