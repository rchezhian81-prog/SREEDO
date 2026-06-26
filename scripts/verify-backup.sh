#!/usr/bin/env bash
#
# verify-backup.sh — prove a dump is restorable (a backup you can't restore is
# not a backup). Restores the dump into a DISPOSABLE scratch database, counts a
# few core tables, then drops the scratch database. Touches nothing else.
#
# Usage:
#   ADMIN_URL=postgres://user:pass@host:5432/postgres ./scripts/verify-backup.sh <dumpfile>
#
# Env:
#   ADMIN_URL   required — connection to a database you may CREATE/DROP from
#               (e.g. the maintenance 'postgres' DB). A scratch DB is created
#               off the same server and dropped at the end.
#   SCRATCH_DB  scratch database name (default: sreedo_verify_<pid>)
#
set -euo pipefail

ADMIN_URL="${ADMIN_URL:-}"
DUMP="${1:-}"
SCRATCH_DB="${SCRATCH_DB:-sreedo_verify_$$}"

if [[ -z "$ADMIN_URL" || -z "$DUMP" ]]; then
  echo "Usage: ADMIN_URL=... $0 <dumpfile>" >&2
  exit 1
fi
if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: dump file not found: $DUMP" >&2
  exit 1
fi
for bin in psql pg_restore; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: $bin not found" >&2; exit 1; }
done

# Derive a scratch connection string by swapping the database path component.
SCRATCH_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#(/)[^/?]+(\?|$)#\1${SCRATCH_DB}\2#")"

cleanup() {
  echo "Dropping scratch database $SCRATCH_DB"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating scratch database $SCRATCH_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${SCRATCH_DB};"

echo "Restoring dump into scratch database (errors are fatal)"
pg_restore --no-owner --no-privileges --dbname "$SCRATCH_URL" "$DUMP"

echo "Row-count sanity check:"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -At -c "
  SELECT 'institutions=' || count(*) FROM institutions
  UNION ALL SELECT 'users=' || count(*) FROM users
  UNION ALL SELECT 'students=' || count(*) FROM students;" || {
    echo "VERIFY FAILED: core tables missing or unreadable" >&2
    exit 4
  }

echo "VERIFY OK: dump restored cleanly and core tables are present."
