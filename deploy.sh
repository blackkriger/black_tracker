#!/usr/bin/env bash

set -euo pipefail

SERVER="root@server.example"
DEPLOY_DIR="/opt/issues_tracker"
WEB_ROOT="/var/www/tracker"
SITE_ROOT="/var/www/site"
PM2_APP="tracker-api"

SSH_KEEPALIVE=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4)

cd "$(dirname "$0")"

echo ">> Pushing committed work to origin"
git push origin main

echo ">> Building frontend bundle"
( cd frontend && npm run build )

echo ">> Shipping dist to $SERVER:$WEB_ROOT"
tar -czf - -C frontend/dist . \
  | ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
    rm -rf $WEB_ROOT.next && mkdir -p $WEB_ROOT.next && tar -xzf - -C $WEB_ROOT.next; \
    mv -T --exchange $WEB_ROOT.next $WEB_ROOT; \
    rm -rf $WEB_ROOT.next"

echo ">> Shipping site to $SERVER:$SITE_ROOT"
tar -czf - -C site . \
  | ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
    rm -rf $SITE_ROOT.next && mkdir -p $SITE_ROOT.next && tar -xzf - -C $SITE_ROOT.next; \
    if [ -d $SITE_ROOT ]; then mv -T --exchange $SITE_ROOT.next $SITE_ROOT; else mv $SITE_ROOT.next $SITE_ROOT; fi; \
    rm -rf $SITE_ROOT.next"

echo ">> Updating backend (git pull + npm install + migrate + pm2 restart)"
ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
  cd $DEPLOY_DIR && git checkout -- backend/package-lock.json && git pull --ff-only origin main; \
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
