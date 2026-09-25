-- Two hardcoded roles were the brief's answer; ours is that roles will be rows people create later — dev, artist, designer — with their own names and colours. Until then the only thing the code actually needs is "may change how the tracker is set up", so the enum becomes one flag and the word "role" is freed for the real feature.
alter table users add column if not exists is_admin boolean not null default false;
update users set is_admin = true where role = 'admin';
alter table users drop column if exists role;
