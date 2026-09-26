-- Revoking turned out to be a step nobody needs: a link that has not been used is simply deleted, and one that has been used is kept for good. The column added a migration ago never held a value.

alter table invites drop column if exists revoked_at;
