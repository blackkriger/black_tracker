-- The API token is stored the way the session token is: a salted hash, plus the last four characters so the profile can show which token is live. The raw value is printed once, at the moment it is minted, and never again — a database dump is then no longer a set of working tokens.
alter table users rename column api_token to api_token_hash;
alter table users add column if not exists api_token_hint text;
alter table users add column if not exists api_token_created_at timestamptz;
alter table users add column if not exists api_token_last_used_at timestamptz;
