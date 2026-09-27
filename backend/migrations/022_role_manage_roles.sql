-- Handing out roles is a right of its own: the settings screens are open to everyone,
-- so what changes who someone is has to be gated apart from being able to reach it.
alter table roles add column can_manage_roles boolean not null default false;
