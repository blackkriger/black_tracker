-- A marked day can point at the thing it is about: the event's page, and the banner it
-- shows itself with. Both are plain addresses, both optional.

alter table key_dates add column if not exists url text;
alter table key_dates add column if not exists banner text;
