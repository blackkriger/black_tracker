-- An invite is a record of how someone got in, so nothing about it is thrown away. Revoking now marks the link dead instead of deleting the row, and a link that has been used cannot be revoked at all — it has already done its work.

alter table invites add column if not exists revoked_at timestamptz;
