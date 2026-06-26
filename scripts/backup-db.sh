#!/usr/bin/env bash
#
# backup-db.sh — PostgreSQL logical backup for SRE EDU OS.
#
# Creates a compressed, timestamped pg_dump in custom format (-Fc), which
# supports selective/parallel restore and is the input expected by restore-db.sh
# and verify-backup.sh. Safe to run on a live database (pg_dump is consistent).
#
# This is the OS-level companion to the in-app backups module
# (super-admin → Backups), which exports tenant/global data via the API. Run
# this from cron/systemd on the VPS for full-cluster, point-in-time-style dumps.
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup-db.sh [outdir]
#
# Env:
#   DATABASE_URL   required — libpq connection string
#   BACKUP_DIR     output directory (default: ./backups, or $1)
#   RETENTION_DAYS delete dumps older than this many days (default: 14; 0 = keep all)
#
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is required" >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found (install the postgresql-client package)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/sreedo-${STAMP}.dump"

echo "Backing up → $OUT"
# -Fc custom format, -Z6 compression. --no-owner/--no-privileges keep the dump
# portable across roles when restoring into a fresh instance.
pg_dump "$DATABASE_URL" -Fc -Z6 --no-owner --no-privileges -f "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "OK: $OUT ($SIZE)"

if [[ "$RETENTION_DAYS" != "0" ]]; then
  echo "Pruning dumps older than ${RETENTION_DAYS} days in $BACKUP_DIR"
  find "$BACKUP_DIR" -name 'sreedo-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete
fi

echo "Done."
