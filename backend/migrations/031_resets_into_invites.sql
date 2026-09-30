alter table invites add column if not exists for_user uuid references users (id) on delete cascade;

insert into invites (token_hash, hint, created_by, created_at, expires_at, used_at, used_by, for_user)
select r.token_hash, '', coalesce(r.created_by, r.user_id), r.created_at, r.expires_at, r.used_at,
       case when r.used_at is not null then r.user_id end, r.user_id
  from password_resets r;

drop table if exists password_resets;
