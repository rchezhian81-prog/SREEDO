#!/usr/bin/env bash
#
# Safe, repeatable production deploy for gocampusos.com.
# Run ON THE VPS from the repo root:  bash scripts/deploy.sh
# Also invoked by .github/workflows/deploy.yml ("Run workflow"), so a one-click
# CI deploy and a hand-run deploy are byte-for-byte identical.
#
# It encodes every lesson from our manual deploys:
#   - back up the DB first (migrations auto-run on backend boot; forward-only)
#   - preserve the server-local docker-compose.prod.yml across `git pull`
#   - fast-forward pull only (never an accidental merge commit)
#   - rebuild only backend+frontend (never recreate postgres/mongo/nginx)
#   - validate nginx config BEFORE reloading (a bad conf never takes the site down)
#   - reload nginx so it re-resolves the rebuilt backend/frontend
#   - verify /health, and AUTO-ROLL BACK the code to the previous release if it fails
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
HEALTH_URL="${HEALTH_URL:-https://gocampusos.com/health}"
PG_USER="${POSTGRES_USER:-sreedo}"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="backup_${TS}.sql"

# Server-local files that must survive `git pull` — the VPS copies diverge from
# the repo (see CLAUDE.md) and must never be overwritten by it.
PRESERVE=(docker-compose.prod.yml)
PRESERVE_DIR="$(mktemp -d)"

save_local()    { for f in "${PRESERVE[@]}"; do [ -e "$f" ] && cp -a "$f" "$PRESERVE_DIR/"; done; }
restore_local() { for f in "${PRESERVE[@]}"; do b="$PRESERVE_DIR/$(basename "$f")"; [ -e "$b" ] && cp -a "$b" "$f"; done; }

# Whatever happens, put the server-local overrides back — never leave them reverted.
save_local
trap 'restore_local; rm -rf "$PRESERVE_DIR"' EXIT

rebuild() {
  $COMPOSE up -d --build backend frontend || return 1
  $COMPOSE exec -T nginx nginx -t || { echo "!! nginx config test FAILED — not reloading (running nginx untouched)."; return 1; }
  $COMPOSE exec -T nginx nginx -s reload || return 1
}

healthy() {
  sleep 3
  for i in 1 2 3 4 5 6; do
    if out="$(curl -fsk "${HEALTH_URL}" 2>/dev/null)"; then echo "OK: ${out}"; return 0; fi
    echo "   health not ready yet (attempt ${i}/6)…"; sleep 3
  done
  return 1
}

echo "==> 1/5  Backing up all databases -> ${BACKUP}"
$COMPOSE exec -T postgres pg_dumpall -U "${PG_USER}" > "${BACKUP}"
ls -lh "${BACKUP}"
test -s "${BACKUP}" || { echo "!! Backup is empty — aborting."; exit 1; }

PREV_SHA="$(git rev-parse HEAD)"
echo "==> 2/5  Current release: ${PREV_SHA}"

echo "==> 3/5  Pulling latest main (fast-forward; server-local overrides preserved)"
git checkout -- "${PRESERVE[@]}" 2>/dev/null || true   # clear local edits so the ff-pull is clean
git checkout main
git pull --ff-only origin main
restore_local
echo "    now at: $(git rev-parse HEAD)"

echo "==> 4/5  Building backend & frontend (backend auto-migrates on boot)"
echo "==> 5/5  Reload nginx + health check (${HEALTH_URL})"
if rebuild && healthy; then
  docker image prune -f >/dev/null 2>&1 || true                      # reclaim dangling build layers
  ls -1t backup_*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f || true   # keep the 10 newest backups
  echo "==> Deploy complete. Backup kept at ${ROOT}/${BACKUP}"
  exit 0
fi

echo "!! Deploy unhealthy — AUTO-ROLLING BACK code to ${PREV_SHA}."
echo "   NOTE: DB migrations are forward-only and are NOT auto-reverted. If a schema"
echo "   change is the culprit, restore the backup (command printed below)."
git checkout -f "${PREV_SHA}"
restore_local
if rebuild && healthy; then
  echo "==> Rolled back to ${PREV_SHA}: site healthy on the previous release."
  echo "   Fix the bad deploy, then re-run scripts/deploy.sh."
  exit 1
fi
echo "!! Rollback health check ALSO failed — manual recovery required:"
echo "     ${COMPOSE} logs --tail 80 backend"
echo "     DB restore: cat ${ROOT}/${BACKUP} | ${COMPOSE} exec -T postgres psql -U ${PG_USER} -d postgres"
exit 1
