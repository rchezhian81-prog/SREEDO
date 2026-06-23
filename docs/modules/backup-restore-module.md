# Backup & Restore Module

> **Status:** Implemented · **Backend:** `backend/src/modules/backups` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md) · [Deployment §8](../DEPLOYMENT.md)

## 1. Purpose

Platform-level (super-admin) database backup and restore. A backup is a **logical
snapshot** captured inside one `REPEATABLE READ` transaction: every application
table is serialized with `to_jsonb` (so any column type round-trips through
`json_populate_recordset` on restore — no `pg_dump` dependency), plus sequence
positions for global backups. The module supports manual and scheduled backups,
retention ("keep latest N"), audited downloads, a non-destructive restore preview,
and a guarded destructive restore. Two scopes exist: **`global`** (whole database,
the only restorable kind) and **`institution`** (a per-tenant filtered data export,
download only).

This is the operational counterpart to [Deployment §8 — Backups & restore
drill](../DEPLOYMENT.md).

## 2. User roles involved

- **super_admin** — the only human role. The router applies
  `authorize("super_admin")` as a hard boundary above any tenant, then
  `requirePermission("backup:*")` enforces the granular model on top.
- **system / scheduler** — a non-human `SYSTEM_ACTOR` (id `null`, role `system`)
  used when the job worker runs a scheduled backup; audited as such.
- All tenant roles (admin/teacher/accountant/student/parent) are denied every
  backup endpoint (403).

## 3. Main screens / pages

- **Super Admin → Backups:**
  `frontend/src/app/(dashboard)/super-admin/backups/page.tsx` — list backups,
  create-now, edit retention + schedule settings, download, restore preview, and
  the (confirmed) restore.

## 4. Main backend APIs

All under `/api/v1/backups`, guarded by `authenticate` + `authorize("super_admin")`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/backups` | List backups (metadata only; no storage paths) | `backup:read` |
| POST | `/backups` | Trigger a manual backup now (`global` or `institution`) | `backup:create` |
| GET | `/backups/settings` | Read retention + automatic-schedule settings | `backup:read` |
| PATCH | `/backups/settings` | Update retention + schedule (recomputes `next_run_at`) | `backup:manage` |
| GET | `/backups/{id}` | One backup's metadata | `backup:read` |
| DELETE | `/backups/{id}` | Delete a backup + its artifact | `backup:manage` |
| GET | `/backups/{id}/download` | Download the gzipped artifact (audited) | `backup:download` |
| GET | `/backups/{id}/restore/preview` | Non-destructive preview (scope, schema match, per-table counts) | `backup:restore` |
| POST | `/backups/{id}/restore` | Destructive restore (`confirm` always, `force` in prod) | `backup:restore` |

## 5. Database tables / entities

- **`backups`** (PK `id`). Columns: `scope` (`global`/`institution`),
  `institution_id` (null for global; a constraint keeps scope + tenant id in
  agreement), `status` (`pending`/`running`/`success`/`failed`), `trigger`
  (`manual`/`scheduled`), `storage_mode` (`s3`/`local`), `storage_key` (internal
  object key — **never returned by the API**), `size_bytes`, `table_count`,
  `row_count`, `schema_version` (count of applied migrations at backup time),
  `error` (short safe message only), `created_by` (null = system/scheduled),
  `started_at`, `completed_at`.
- **`backup_settings`** — a single-row singleton (`id = 1`): `retention_count`
  (null = retention off, nothing is ever deleted), `schedule_enabled`,
  `schedule_frequency` (`daily`/`weekly`/`monthly`), `schedule_run_time` (HH:MM
  UTC), `next_run_at`, `updated_by`.

Migration `0043_backups.sql`. The public API projection deliberately omits
`storage_key` and exposes `hasArtifact` instead.

**Storage:** artifacts go to object storage when `STORAGE_*` is configured,
otherwise a local-filesystem fallback (`storage` / `storageMode` from
`src/utils/storage.ts`). For durable backups in production, configure object
storage (see [Deployment §8](../DEPLOYMENT.md)).

## 6. Permissions / RBAC involved

Seeded in `0043_backups.sql` and granted **only** to `super_admin`:
`backup:read`, `backup:create`, `backup:download`, `backup:restore`,
`backup:manage`. No tenant role receives any `backup:*` key.

## 7. Tenant isolation notes

Backups sit **above** any tenant: the routes are super-admin-only and are not
tenant-scoped (`requireTenant` is not applied). A `global` backup spans the whole
database; an `institution` backup filters every table that has an `institution_id`
column to a single tenant (download-only data export, not restorable). The public
projection never leaks `storage_key` or the `backups/...` object path, verified by
tests that assert the path never appears in list/detail/download responses.

## 8. Key workflows

1. **Manual backup** — `POST /backups` inserts a `running` row, builds the dump in
   one `REPEATABLE READ` transaction, stores it at `backups/{id}.json.gz`, marks
   `success` with size/table/row/schema metadata, records the metric and a
   `backup.create` audit entry, then applies retention. Failures are caught,
   recorded as `failed` with a safe error, audited (`backup.failed`), and re-thrown
   as 500.
2. **Retention** — after each successful backup, `applyRetention` keeps the latest
   `retention_count` successful backups **of that scope** and deletes older
   artifacts + rows (audited `backup.retention`). When `retention_count` is null,
   retention is OFF and nothing is deleted.
3. **Scheduled backup** — the job worker tick calls `enqueueDueScheduledBackups`:
   if the schedule is enabled and `next_run_at` is due, it enqueues a
   `scheduled_backup` job (deduped per window via `dedupeKey`) and advances
   `next_run_at`. The worker's `scheduled_backup` handler calls
   `runScheduledBackup` (global, trigger `scheduled`, `SYSTEM_ACTOR`).
4. **Restore preview** — `GET /{id}/restore/preview` decodes the artifact and
   reports scope, backup vs current schema version, `schemaMatches`, `restorable`
   (true only for a global backup with a matching schema), and per-table counts.
   Non-destructive.
5. **Restore (destructive)** — `POST /{id}/restore` requires `confirm:true`
   always and, when `env.isProduction`, also `force:true`. Only global backups are
   restorable, and the schema version must match. The restore runs in **one
   transaction** with `SET LOCAL session_replication_role = replica` (disables FK
   checks/triggers so tables can `TRUNCATE … RESTART IDENTITY CASCADE` and reload
   in any order), reloads rows via `json_populate_recordset`, and resets sequences.
   The attempt is audited up front (`restore.start`) plus `restore.success` /
   `restore.failed`. A failure rolls everything back.

> **Privilege note:** `session_replication_role = replica` needs a DB superuser.
> The Compose `POSTGRES_USER` (`sreedo`) is the bootstrap superuser, so restore
> works under Compose; on managed Postgres the connection role must be able to set
> it. See [Deployment §8](../DEPLOYMENT.md).

## 9. Test coverage summary

`backend/tests/integration/backups.int.test.ts` covers: manual global backup
metadata with no storage-path leakage; list/detail without leaking paths; audited
gzip download; **403 for non-super-admins on every endpoint**; restore requires
explicit confirmation; non-destructive preview; a confirmed global restore that
preserves row counts and is durably audited (`restore.success`); rejecting an
institution-scoped restore; retention keep-latest-N and never-delete-when-unset;
end-to-end scheduled backup (enqueue tick → worker run); a `backup.create` audit
entry; and backup/restore metrics + overview exposed without secrets.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Restore returns 400 "requires force=true" | Running in production without `force` | Send `{ "confirm": true, "force": true }` (practise on staging first) |
| Restore returns 400 "Only global backups can be restored" | Trying to restore an `institution` export | Institution backups are download-only; restore a `global` backup |
| Restore fails: schema version mismatch | Backup taken at a different migration count | Restore only into a DB at the same migration version |
| Restore fails: permission denied to set session_replication_role | DB role is not a superuser | Use a superuser connection (Compose `sreedo` is; see Deployment §8) |
| Old backups never pruned | `retention_count` is null (retention OFF) | Set a retention count via `PATCH /backups/settings` |
| Scheduled backup never runs | `JOB_WORKER_ENABLED` off, or schedule disabled | Enable the worker and the schedule; the tick enqueues `scheduled_backup` |
| Any backup endpoint returns 403 | Caller is not `super_admin` | Backups are platform-only |

## 11. Future enhancement notes

- Restorable institution-scoped restore (currently export-only).
- Encryption-at-rest for artifacts and signed download URLs.
- Off-site / cross-region replication of artifacts.
- Point-in-time recovery via WAL archiving (complements logical snapshots).
- Items marked "(to confirm)": none — behaviour maps to `backups.service.ts`,
  `backups.routes.ts`, the job worker wiring, and the integration test.
