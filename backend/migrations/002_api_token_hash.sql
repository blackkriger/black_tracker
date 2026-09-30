alter table users rename column api_token to api_token_hash;
alter table users add column if not exists api_token_hint text;
alter table users add column if not exists api_token_created_at timestamptz;
alter table users add column if not exists api_token_last_used_at timestamptz;
