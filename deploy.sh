#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f deploy.env ]; then
  echo "!! deploy.env is missing: copy deploy.env.example and fill it in."
  exit 1
fi
set -a
. ./deploy.env
set +a
: "${SERVER:?set SERVER in deploy.env}" "${DEPLOY_DIR:?set DEPLOY_DIR in deploy.env}"
: "${WEB_ROOT:?set WEB_ROOT in deploy.env}" "${PM2_APP:?set PM2_APP in deploy.env}"
: "${HEALTH_URL:?set HEALTH_URL in deploy.env}"

SSH_KEEPALIVE=(-o ServerAliveInterval=15 -o ServerAliveCountMax=4)

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

echo ">> Updating backend (git pull + npm install + migrate + pm2 restart)"
ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "set -e; \
  cd $DEPLOY_DIR && git checkout -- backend/package-lock.json && git pull --ff-only origin main; \
  cd $DEPLOY_DIR/backend && npm install --no-audit --no-fund 2>&1 | tail -3 && npm run migrate && pm2 restart $PM2_APP --update-env"

echo ">> Waiting for $HEALTH_URL"
for _ in $(seq 1 20); do
  code=$(ssh "${SSH_KEEPALIVE[@]}" "$SERVER" "curl -s -o /dev/null -w '%{http_code}' '$HEALTH_URL'" || echo "000")
  if [ "$code" = "200" ]; then
    echo "   health: 200"
    echo ">> Done."
    exit 0
  fi
  sleep 1
done

echo "!! Backend never returned 200. Check 'pm2 logs $PM2_APP' on the server."
exit 1
