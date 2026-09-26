-- Deleting is a right, not a side effect of being able to reach a thing: it takes away work someone else has done. A role can be given it; the creator holds it through is_admin. Roles, invites and accounts stay admin-only, so nobody can be granted the power to dismantle the rules they live under.

alter table roles add column if not exists can_delete boolean not null default false;
