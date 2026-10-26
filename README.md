# Tracker

A self-hosted issue tracker with boards, built for a small team. No sign-up: an admin sends an invite link, whoever opens it picks a login and password.

## What it does

- Projects with boards. Each board has its own statuses, and cards are dragged between and within columns.
- An issue window with a rich-text description (checklists, images, Google Docs import), an expected result, status, priority, assignee, watcher, due date, tags, files, links to other issues, private stars, comments that can be pinned and quoted, and the full history of changes.
- Filters by project, status, assignee, author, watcher, tags, text and period; an Issues list and Analytics across projects; a calendar of key dates and sticky notes on the dashboard.
- Live updates: every change reaches open tabs over a server-sent event stream.
- Roles with per-project and per-board denials, and two rights a role may hold: deleting things and handing out roles.
- Personal API tokens for scripts and integrations. A token moves work along; comments and everything it writes carry an API mark.
- GitHub pushes linked to issues by key, a Commits page, and unlinking or moving commits by hand.
- Builds per project for Windows and macOS, uploaded up to 1 GB or linked from Google Drive, with public endpoints that serve the latest one.
- Notifications in Telegram and VK; public endpoints for an external feedback form, with a report inside the tracker.
- Russian and English, dark and light themes.

## Stack

- **backend** — Node + Fastify + PostgreSQL, TypeScript run through `tsx` (no build step). No ORM; migrations are numbered `.sql` files.
- **frontend** — Vue 3 + Vite, one stylesheet (`src/styles/tracker.css`) carrying the whole visual system, Quill 2 + DOMPurify for the text people write, `lucide-vue-next` for icons.

## Decisions everything leans on

- **A project starts empty.** Its boards are added from its settings screen, each arriving with the starting four statuses.
- **Statuses are rows, not an enum.** Adding one is an insert; the board grows a column with no deploy. `is_resolved` is what "closed" means and stamps `issues.resolved_at`.
- **A board owns its columns.** Statuses hang off `boards`, so two boards in one project can run different workflows, and an issue lives on exactly one board.
- **An issue's key belongs to the project.** `PROJ-12` comes from the project's own counter, so moving a card between boards never changes it.
- **Access is a denial list on roles.** A role can be shut out of a whole project or of single boards; someone with no role reaches nothing but their own profile.
- **The settings screens are everyone's; two rights are not.** `roles.can_delete` allows deleting anything people made, `roles.can_manage_roles` allows handing someone a role and minting invite links. What a role itself may do, and the accounts behind people, stay with the admin.

## Installing on a server

You need a Linux server with Node 20 or newer, PostgreSQL 13 or newer, nginx and pm2, and a domain pointing at it. The examples use `tracker.example.com`, `/opt/tracker` for the code and `/var/www/tracker` for the built frontend.

**1. Database**

```bash
sudo -u postgres psql -c "create role tracker login password 'change-me'"
sudo -u postgres psql -c "create database tracker owner tracker"
```

**2. Backend**

```bash
git clone https://github.com/blackkriger/issues_tracker.git /opt/tracker
cd /opt/tracker/backend
cp .env.example .env
npm install
```

Fill `.env` (see [Configuration](#configuration)): at least `DATABASE_URL`, a long random `SESSION_SECRET` (`openssl rand -hex 32`), `PUBLIC_URL=https://tracker.example.com`, `CORS_ORIGIN=https://tracker.example.com`, an absolute `UPLOAD_DIR` and `SECURE_COOKIES=true`. Then:

```bash
npm run migrate
npm run create-user -- <login> <password> admin "Your name"
pm2 start npm --name tracker-api -- start
pm2 save && pm2 startup
```

The backend listens on `127.0.0.1:3100` and trusts forwarded addresses only from `127.0.0.1`, so nginx runs on the same host.

**3. Frontend**

```bash
cd /opt/tracker/frontend
npm install
npm run build
mkdir -p /var/www/tracker && cp -r dist/. /var/www/tracker/
```

**4. nginx**

```nginx
server {
  listen 80;
  server_name tracker.example.com;
  root /var/www/tracker;
  index index.html;
  client_max_body_size 110m;

  location ^~ /api/ {
    proxy_pass http://127.0.0.1:3100/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }

  location = /api/builds {
    proxy_pass http://127.0.0.1:3100/builds;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ^~ /api/builds/ {
    client_max_body_size 1100m;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_pass http://127.0.0.1:3100/builds/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Reload nginx and add HTTPS with `certbot --nginx -d tracker.example.com`. Open the site and sign in as the admin; everyone else joins through invite links from Settings → Users & access.

## Connecting

**API.** Settings → API creates a personal token, shown once. Calls carry it as a bearer token:

```bash
curl -H "Authorization: Bearer trk_…" https://tracker.example.com/api/issues/PROJ-1
```

A token reads and creates issues, changes their fields, moves them between statuses and boards, writes, edits, pins and deletes comments, attaches files and marks notices read. Reactions and account settings need a browser session.

**GitHub.** Set `GITHUB_WEBHOOK_SECRET`, then add a webhook to the repository: payload URL `https://tracker.example.com/api/git/github`, content type `application/json`, the same secret, the push event only. In the tracker, set the project's repository (`owner/name`) on its settings screen. A commit that mentions an issue key such as `PROJ-12` is linked to that issue; each person fills in their GitHub name in Profile so their commits show under them.

**Telegram.** Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` (without `@`) and a random `TELEGRAM_WEBHOOK_SECRET`. On start the backend registers its webhook at `PUBLIC_URL/api/telegram`. Each person connects the bot from Profile; it then delivers notices and creates issues with `/issue`.

**VK.** Set `VK_GROUP_TOKEN`, a community token that can manage the community and send messages, and a random `VK_SECRET`. On start the backend registers its callback server at `PUBLIC_URL/api/vk`. People connect it from Profile, as with Telegram.

**Public endpoints.** These need no account and are meant for an external site:

- `POST /api/public/feedback/send` and `/api/public/feedback/track` take answers and visit statistics for a feedback form; the report is under Feedback in the tracker.
- `GET /api/public/demo` lists the latest Windows and macOS builds of `DEMO_PROJECT`; `/api/public/demo/entry` and `/api/public/demo/windows|macos` serve a page or a download through nginx `X-Accel-Redirect` to an internal `/demo-files/` location aliased to `UPLOAD_DIR`, or redirect to Google Drive.

## Configuration

`backend/.env`:

- `DATABASE_URL`, `SESSION_SECRET` — required. Rotating the secret signs everyone out and voids API tokens and invite links.
- `PORT` — the backend port, `3100` by default.
- `PUBLIC_URL` — the address links in messages and webhooks point at.
- `CORS_ORIGIN` — allowed origins, comma-separated.
- `SECURE_COOKIES` — `true` behind HTTPS.
- `UPLOAD_DIR` — where files and builds are stored; `GEOIP_DIR` — where the free DB-IP country database is kept for the feedback report.
- `DEMO_PROJECT` — the project key whose latest builds the public demo endpoints serve.
- `GITHUB_WEBHOOK_SECRET` — secret of the GitHub webhook.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `TELEGRAM_WEBHOOK_SECRET` — the Telegram bot, optional.
- `VK_GROUP_TOKEN`, `VK_SECRET` — the VK community bot, optional.

## Developing

Point `DATABASE_URL` in `backend/.env` at a PostgreSQL database, then:

```bash
cd backend
npm install
npm run migrate
npm start                 # 127.0.0.1:3100
```

```bash
cd frontend
npm install
npm run dev               # 127.0.0.1:5174, proxies /api to 127.0.0.1:3100
```

`npm run typecheck` in either half. The backend runs through `tsx`, so a type error there is a runtime crash.

## Deploying updates

`./deploy.sh` from the repo root does the whole round: push, build the SPA, ship `dist` to the docroot, then `git pull` + `npm install` + `npm run migrate` + pm2 restart on the server, and poll the health URL. Commit first — the server pulls. Where it goes comes from `deploy.env` (copy `deploy.env.example`): the ssh target, the code and docroot paths, the pm2 app and the health URL, such as `https://tracker.example.com/api/health`. `deploy.env` stays local and out of git.

## License

MIT, see [LICENSE](./LICENSE).
