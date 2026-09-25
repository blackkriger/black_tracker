#!/usr/bin/env bash
# Deploy for tracker.example.com, the same shape as another project's one: build the SPA locally, ship dist to the nginx docroot, then on the server git pull + npm install + migrate + pm2 restart, and wait for /health.
#
# Prerequisites:
#  - Local: Node + npm, push rights on the repo.
#  - Server: nginx serving /var/www/tracker, the backend under pm2 as "tracker-api", the `tracker` database on the host Postgres.

set -euo pipefail

SERVER="root@server.example"
DEPLOY_DIR="/opt/issues_tracker"
WEB_ROOT="/var/www/tracker"
PM2_APP="tracker-api"

# Quiet stretches — the tar pipe, the server-side npm install — otherwise look like a dead link to a stateful firewall on the path.
SSH_KEEPALIVE=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4)

cd "$(dirname "$0")"

echo ">> Pushing committed work to origin"
# The server pulls, so uncommitted backend work and new migrations never reach prod without this.
git push origin main

echo ">> Building frontend bundle"
( cd frontend && npm run build )

echo ">> Shipping dist to $SERVER:$WEB_ROOT"
# Unpacked beside the live docroot and swapped in one rename, so no request lands on a half-written directory.
tar -czf - -C frontend/dist . \
  | ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
    rm -rf $WEB_ROOT.next && mkdir -p $WEB_ROOT.next && tar -xzf - -C $WEB_ROOT.next; \
    mv -T --exchange $WEB_ROOT.next $WEB_ROOT; \
    rm -rf $WEB_ROOT.next"

echo ">> Updating backend (git pull + npm install + migrate + pm2 restart)"
ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
  cd $DEPLOY_DIR && git pull --ff-only origin main; \
  cd $DEPLOY_DIR/backend && npm install --no-audit --no-fund 2>&1 | tail -3 && npm run migrate && pm2 restart $PM2_APP --update-env"

echo ">> Waiting for /health"
for _ in $(seq 1 20); do
  code=$(ssh "${SSH_KEEPALIVE[@]}" "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" https://tracker.example.com/health' || echo "000")
  if [ "$code" = "200" ]; then
    echo "   health: 200"
    echo ">> Done."
    exit 0
  fi
  sleep 1
done

echo "!! Backend never returned 200. Check 'pm2 logs tracker-api' on the server."
exit 1
