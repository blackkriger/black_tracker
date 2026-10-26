# Tracker

A self-hosted issue tracker with boards, built for a small team and the AI agents working alongside it. No sign-up: an admin sends an invite link, whoever opens it picks a login and password.

## What it does

- Projects with boards. Each board has its own statuses, and cards are dragged between and within columns.
- An issue window with a rich-text description (checklists, images, Google Docs import), an expected result, status, priority, assignee, watcher, due date, tags, files, links to other issues, private stars, comments that can be pinned and quoted, and the full history of changes.
- Filters by project, status, assignee, author, watcher, tags, text and period; an Issues list and Analytics across projects; a calendar of key dates and sticky notes on the dashboard.
- Live updates: every change reaches open tabs over a server-sent event stream.
- Roles with per-project and per-board denials, and two rights a role may hold: deleting things and handing out roles.
- Personal API tokens for agents and scripts. A token moves work along; comments and everything it writes carry an API mark.
- GitHub pushes linked to issues by key, a Commits page, and unlinking or moving commits by hand.
- Builds per project for Windows and macOS, uploaded up to 1 GB or linked from Google Drive, with public endpoints that serve the latest one.
- Notifications in Telegram and VK; public endpoints for an external feedback form, with a report inside the tracker.
- Russian and English, dark and light themes.

## Stack

- **backend** — Node + Fastify + PostgreSQL, TypeScript run through `tsx` (no build step). No ORM; migrations are numbered `.sql` files applied at deploy.
- **frontend** — Vue 3 + Vite, one stylesheet (`src/styles/tracker.css`) carrying the whole visual system, Quill 2 + DOMPurify for the text people write, `lucide-vue-next` for icons.

## Decisions everything leans on

- **A project starts empty.** Its boards are added from its settings screen, each arriving with the starting four statuses.
- **Statuses are rows, not an enum.** Adding one is an insert; the board grows a column with no deploy. `is_resolved` is what "closed" means and stamps `issues.resolved_at`.
- **A board owns its columns.** Statuses hang off `boards`, so two boards in one project can run different workflows, and an issue lives on exactly one board.
- **An issue's key belongs to the project.** `PROJ-12` comes from the project's own counter, so moving a card between boards never changes it.
- **Access is a denial list on roles.** A role can be shut out of a whole project or of single boards; someone with no role reaches nothing but their own profile.
- **The settings screens are everyone's; two rights are not.** `roles.can_delete` allows deleting anything people made, `roles.can_manage_roles` allows handing someone a role and minting invite links. What a role itself may do, and the accounts behind people, stay with the admin.

## Running it

Point `DATABASE_URL` at a PostgreSQL database before starting.

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

`npm run typecheck` in either half. The backend runs through `tsx`, so a type error there is a runtime crash.

## Configuration

`backend/.env`:

- `DATABASE_URL`, `SESSION_SECRET` — required. Rotating the secret signs everyone out and voids API tokens and invite links.
- `PORT` — the backend port, `3100` by default.
- `PUBLIC_URL` — the address links in messages and webhooks point at.
- `CORS_ORIGIN` — allowed origins, comma-separated.
- `SECURE_COOKIES` — `true` behind HTTPS.
- `UPLOAD_DIR` — where files and builds are stored; `GEOIP_DIR` — where the free DB-IP country database is kept for the feedback report.
- `DEMO_PROJECT` — the project whose latest builds the public demo endpoints serve.
- `GITHUB_WEBHOOK_SECRET` — secret of the GitHub webhook pointed at `/api/git/github`.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `TELEGRAM_WEBHOOK_SECRET` — the Telegram bot, optional.
- `VK_GROUP_TOKEN`, `VK_SECRET` — the VK community bot, optional.

## Deploying

`./deploy.sh` from the repo root does the whole round: push, build the SPA, ship `dist` to the docroot, then `git pull` + `npm install` + `npm run migrate` + pm2 restart on the server, and poll the health URL. Commit first — the server pulls. Where it goes comes from `deploy.env` (copy `deploy.env.example`): the ssh target, the code and docroot paths, the pm2 app and the health URL. `deploy.env` stays local and out of git.

The server needs Node, PostgreSQL, pm2 and nginx: nginx serves the built frontend, proxies `/api/` to the backend port and terminates HTTPS. Build uploads need their own nginx location with a larger body limit and buffering off.

## License

MIT, see [LICENSE](./LICENSE).
