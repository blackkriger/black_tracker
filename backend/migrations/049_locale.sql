alter table users add column if not exists lang text not null default 'system' check (lang in ('system', 'en', 'ru'));
alter table users add column if not exists lang_seen text check (lang_seen in ('en', 'ru'));
alter table users add column if not exists gender text check (gender in ('m', 'f'));
