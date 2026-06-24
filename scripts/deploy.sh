#!/usr/bin/env bash
#
# Safe, repeatable production deploy for gocampusos.com.
# Run ON THE VPS from the repo root:  bash scripts/deploy.sh
#
# It encodes the steps that bit us during the first manual deploy:
#   - always back up the DB first (migrations auto-run on backend boot)
#   - rebuild only backend+frontend (never recreate postgres/mongo)
#   - validate nginx config BEFORE reloading (a bad conf never takes the site down)
#   - reload nginx so it re-resolves the rebuilt backend (the missing step that 502'd us)
#   - verify /health before declaring success
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
HEALTH_URL="${HEALTH_URL:-https://gocampusos.com/health}"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="backup_${TS}.sql"

echo "==> 1/6  Backing up all databases -> ${BACKUP}"
$COMPOSE exec -T postgres pg_dumpall -U sreedo > "${BACKUP}"
ls -lh "${BACKUP}"
test -s "${BACKUP}" || { echo "!! Backup is empty — aborting."; exit 1; }

echo "==> 2/6  Pulling latest main"
git pull origin main

echo "==> 3/6  Building + starting backend & frontend (backend auto-migrates on boot)"
$COMPOSE up -d --build backend frontend

echo "==> 4/6  Validating nginx config"
if ! $COMPOSE exec -T nginx nginx -t; then
  echo "!! nginx config test FAILED — NOT reloading; the running site is untouched."
  echo "   Fix infra/nginx/production.conf and re-run, or roll back with: git checkout <prev-sha>"
  exit 1
fi

echo "==> 5/6  Reloading nginx (re-resolves the new backend/frontend IPs)"
$COMPOSE exec -T nginx nginx -s reload

echo "==> 6/6  Health check (${HEALTH_URL})"
sleep 3
for i in 1 2 3 4 5 6; do
  if out="$(curl -fsk "${HEALTH_URL}" 2>/dev/null)"; then
    echo "OK: ${out}"
    echo "==> Deploy complete. Backup kept at $(pwd)/${BACKUP}"
    exit 0
  fi
  echo "   health not ready yet (attempt ${i}/6)…"; sleep 3
done

echo "!! Health check did not pass. Investigate:"
echo "     ${COMPOSE} logs --tail 60 backend"
echo "   Roll back: git checkout <prev-sha> && ${COMPOSE} up -d --build backend frontend && ${COMPOSE} exec -T nginx nginx -s reload"
echo "   Restore DB: cat ${BACKUP} | ${COMPOSE} exec -T postgres psql -U sreedo -d postgres"
exit 1
