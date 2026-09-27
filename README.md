# tracker.example.com

A small issue tracker with boards for our own projects. Private instance, no sign-up: an admin mints an invite link and whoever opens it picks their own login and password. Separate from another project in every way that matters — own database, own subdomain, own accounts — and related to it only by looks.

## Stack

- **backend** — Node + Fastify + Postgres, TypeScript run through `tsx` (no build step). No ORM; migrations are numbered `.sql` files applied at deploy.
- **frontend** — Vue 3 + Vite, one stylesheet (`src/styles/tracker.css`) carrying the whole visual system, Quill 2 + DOMPurify for the text people write, `lucide-vue-next` for icons.
- Two ways in: a session cookie for the browser, a personal API token for agents. **A token cannot speak as a person** — comments, pinning and account settings all demand a session; the token moves work along.
- Every change is announced on a server-sent stream (`GET /api/events`), so open tabs redraw as other people work.

## Shape of the data

Sixteen tables. From the brief: `users`, `projects`, `states`, `issues`, `issue_comments`, `issue_attachments`, `issue_history`, `tags` + `issue_tags`, `boards`. Added since: `sessions`, `invites`, `roles`, `board_denials` + `project_denials`, `issue_links`, `issue_favourites` — and `schema_migrations`, which the migrator keeps.

The decisions everything else leans on:

- **A project starts empty.** Its boards are added from its settings screen, each arriving with the starting four statuses.
- **Statuses are rows, not an enum.** Adding one is an insert; the board grows a column with no deploy. `is_resolved` is what "closed" means and stamps `issues.resolved_at`; a status is open or resolved, never both.
- **A board owns its columns.** Statuses hang off `boards`, so two boards in one project can run different workflows, and an issue lives on exactly one board. A board is addressed by a slug unique inside the project, not by its id.
- **An issue's key belongs to the project.** `PROJ-12` comes from the project's own counter, so moving a card between boards never changes it.
- **Access is a denial list on roles.** A role can be shut out of a whole project or of single boards; someone with no role reaches nothing but their own profile, refused at one wall rather than route by route; `users.is_admin` stands outside all of it.
- **The settings screens are everyone's; two rights are not.** `roles.can_delete` allows deleting anything people made, `roles.can_manage_roles` allows handing someone a role and minting invite links. What a role itself may do — its denials, its rights, whether it exists — and the accounts behind people stay with the creator.

## Running it

The database lives on the server; there is no local Postgres. Point `DATABASE_URL` at one before starting.

```bash
cd backend
cp .env.example .env      # fill DATABASE_URL and SESSION_SECRET
npm install
npm run migrate
npm run create-user -- <login> <password> admin "Full name"
npm start                 # 127.0.0.1:3100
```

```bash
cd frontend
npm install
npm run dev               # 127.0.0.1:5174, proxies /api to 127.0.0.1:3100
```

`npm run typecheck` in either half. The backend runs through `tsx`, so a type error there is a runtime crash — check before deploying.

## Server

`server.example`. nginx terminates HTTPS for `tracker.example.com` and proxies `/api/` to `127.0.0.1:3100`; the built frontend is served from `/var/www/tracker`. The backend lives in `/opt/issues_tracker` and runs under PM2 as `tracker-api`. Postgres role and database `tracker`. Uploads land in `/var/lib/tracker/uploads`, 10 MB a file, served by the API behind the same board check as the issue they hang off.

`https://tracker.example.com/db/` is a **pgweb** on the tracker database (`pgweb-tracker.service`, `127.0.0.1:8082`) behind its own nginx basic auth — `/etc/nginx/htpasswd-tracker`, not another project's credentials. The tracker's own sign-in does not guard it.

`./deploy.sh` from the repo root does the whole round: push, build the SPA, ship `dist` to the docroot, then `git pull` + `npm install` + `npm run migrate` + pm2 restart on the server, and poll `/health`. Commit first — the server pulls.

```bash
ssh root@server.example
cd /opt/issues_tracker/backend
npm run create-user -- <login> <password> admin "Full name"   # also resets a password
pm2 logs tracker-api --lines 50
pm2 restart tracker-api --update-env
sudo -u postgres psql -d tracker
```
