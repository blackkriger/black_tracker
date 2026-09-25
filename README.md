# tracker.example.com

A small issue tracker with boards for our own projects. Private instance, no sign-up: accounts are created by an admin. Separate from another project in every way that matters — own database, own subdomain, own accounts — and related to it only by looks.

## Stack

- **backend** — Node + Fastify + Postgres, TypeScript run through `tsx` (no build step). No ORM; migrations are numbered `.sql` files applied at deploy.
- **frontend** — Vue 3 + Vite, one stylesheet (`src/styles/tracker.css`) carrying the whole visual system.
- Two ways in: a session cookie for the browser, a personal API token for agents. **A token cannot post comments** — it moves work along, it does not speak as a person.

## Shape of the data

Nine tables from the brief, plus per-board denials and sessions: `users`, `projects`, `states`, `issues`, `issue_comments`, `issue_attachments`, `issue_history`, `tags` + `issue_tags`, `boards` + `board_denials`, `sessions`.

Two decisions everything else leans on:

- **Statuses are rows, not an enum.** Adding one is an insert; the board grows a column with no deploy. `is_resolved` is what "closed" means and stamps `issues.resolved_at`.
- **A board is a saved filter over a project, and its columns are the project's states.** There is no column entity to keep in sync with anything.

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

nginx terminates HTTPS for `tracker.example.com` and proxies `/api/` to `127.0.0.1:3100`; the built frontend is served from `/var/www/tracker`. The process runs under PM2 as `tracker-api`. Postgres role and database `tracker`.
