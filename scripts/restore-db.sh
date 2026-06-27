#!/usr/bin/env bash
#
# restore-db.sh — restore a pg_dump (custom format) produced by backup-db.sh.
#
# DESTRUCTIVE: --clean drops and recreates objects before restoring. This script
# refuses to run unless you explicitly confirm, and refuses a production-looking
# target unless FORCE=1 is set. NEVER wire this into automated deploys.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/restore-db.sh <dumpfile>
#
# Env:
#   DATABASE_URL   required — TARGET database to restore INTO
#   CONFIRM        must equal "yes" to proceed (or pass -y)
#   FORCE          set to 1 to allow a target whose name/host looks like prod
#
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
DUMP="${1:-}"
CONFIRM="${CONFIRM:-}"
[[ "${2:-}" == "-y" ]] && CONFIRM="yes"

if [[ -z "$DATABASE_URL" || -z "$DUMP" ]]; then
  echo "Usage: DATABASE_URL=... $0 <dumpfile> [-y]" >&2
  exit 1
fi
if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: dump file not found: $DUMP" >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found (install the postgresql-client package)" >&2
  exit 1
fi

# Guard against accidentally clobbering production.
if [[ "$DATABASE_URL" == *prod* || "$DATABASE_URL" == *production* ]]; then
  if [[ "${FORCE:-}" != "1" ]]; then
    echo "REFUSING: target looks like production. Re-run with FORCE=1 if you are certain." >&2
    exit 2
  fi
  echo "WARNING: FORCE=1 set — restoring into a production-looking target."
fi

echo "About to restore (DESTRUCTIVE, --clean):"
echo "  dump:   $DUMP"
echo "  target: ${DATABASE_URL%%\?*}"
if [[ "$CONFIRM" != "yes" ]]; then
  read -r -p "Type 'yes' to proceed: " CONFIRM
fi
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 3
fi

# --clean --if-exists drops objects first; --no-owner avoids role mismatches.
# Exit status is non-zero on any error item; --exit-on-error makes it strict.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" "$DUMP"

echo "Restore complete."
