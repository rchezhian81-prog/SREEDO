# Reports Center Module

> **Status:** Implemented · **Backend:** `backend/src/modules/reportcenter` + `backend/src/modules/scheduledreports` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md) · [Custom report builder](./custom-report-builder-module.md)

## 1. Purpose

The Reports Center is a registry of **pre-built (canned) cross-module reports** —
student roster, attendance, fee collection/dues, exam results, homework,
communication, documents, timetable, plus college, library, transport, hostel,
inventory, staff-attendance/leave, payroll and online-payment reports (~55 in
total). Each report runs filtered + tenant-scoped and can be exported to **CSV or
PDF**.

**Scheduled Reports** layers automated recurring delivery on top: a schedule
points at a saved [Custom Report](./custom-report-builder-module.md), runs on a
daily/weekly/monthly cadence (or on demand), and delivers the generated CSV/PDF
to authorized users in-app and/or by email. Automated runs are dispatched by the
background job worker (`scheduled_report_run` jobs).

This module also relates to the `reports/` module (printable **report cards** and
class **mark sheets**) and `data_exports` (super-admin summary export history).

## 2. User roles involved

| Role | Capability |
|------|-----------|
| `admin` | Run/export every report; full scheduled-report lifecycle incl. `manage` |
| `accountant` | Reports they hold the underlying permission for (e.g. fees); scheduled reports all except `manage` |
| `teacher` | Reports they hold the underlying permission for (e.g. attendance/exams/homework); scheduled read/create/run/history |
| `student`/`parent` | No Reports Center or Scheduled Reports access |
| `super_admin` | Bypasses permission checks |

## 3. Main screens / pages

- Reports Center: `/reports-center` -> `frontend/src/app/(dashboard)/reports-center/page.tsx`
  (list available reports, run with filters, download CSV/PDF/print).
- Scheduled Reports: `/scheduled-reports` (list) plus `/scheduled-reports/new`,
  `/scheduled-reports/[id]`, `/scheduled-reports/[id]/edit` under
  `frontend/src/app/(dashboard)/scheduled-reports/`.

## 4. Main backend APIs

Reports Center — `backend/src/modules/reportcenter/reportcenter.routes.ts`
(`authenticate, requireTenant`):

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/report-center` | List available reports (key, title, category, permission) | `reports:center:read` |
| GET | `/report-center/{key}` | Run a report -> `{ title, columns, rows }` (filtered, tenant-scoped) | the report's own permission |
| GET | `/report-center/{key}/export` | Export CSV (default) or PDF (`?format=pdf`) | report's permission + `reports:center:export` |

Each report declares its own `permission` (e.g. `reports:attendance:read`,
`reports:fees:read`, `reports:exams:read`, `college:read`, `library:reports`,
`payroll:reports`); the route checks it per call (`assertPerm`).

Scheduled Reports — `backend/src/modules/scheduledreports/scheduledreports.routes.ts`:

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/scheduled-reports` | List schedules (with last run) | `scheduled_reports:read` |
| POST | `/scheduled-reports` | Create a schedule over a saved report (validates the creator's underlying permission) | `scheduled_reports:create` |
| GET | `/scheduled-reports/{id}` | Get a schedule | `scheduled_reports:read` |
| PATCH | `/scheduled-reports/{id}` | Edit / enable / disable | `scheduled_reports:update` |
| DELETE | `/scheduled-reports/{id}` | Delete | `scheduled_reports:delete` |
| POST | `/scheduled-reports/{id}/run` | Run now (as the caller; records run history) | `scheduled_reports:run` |
| GET | `/scheduled-reports/{id}/runs` | Run history | `scheduled_reports:history` |
| POST | `/scheduled-reports/run-due` | Process due schedules (scheduler tick; each as its creator) | `scheduled_reports:manage` |

Related (cross-link): `reports/` — `GET /reports/report-card` (owner-scoped),
`GET /reports/mark-sheet` (staff), grade-band CRUD; `data_exports` is written by
the super-admin module.

## 5. Database tables / entities

- **Reports Center has no table of its own** — reports are defined in code
  (`REPORTS` registry in `reportcenter.service.ts`) and run live SQL against
  feature tables, all `institution_id`-filtered.
- **`scheduled_reports`** (migration `0038_scheduled_reports.sql`): `id`,
  `institution_id`, `report_id` -> `custom_reports` (**ON DELETE SET NULL**),
  `name`, `frequency` (daily/weekly/monthly), `run_time` (HH:MM, default `06:00`),
  `timezone` (default `UTC`), `day_of_week`, `day_of_month`, `recipients` (JSONB
  user ids), `channels` (JSONB; `in_app`/`email`), `export_format`
  (csv/pdf/both), `enabled`, `last_run_at`, `next_run_at`, `created_by`,
  timestamps. Indexed for due lookup `(institution_id, enabled, next_run_at)`.
- **`scheduled_report_runs`** (same migration): audit history — `status`
  (pending/running/success/failed/skipped), `trigger` (manual/scheduled),
  `started_at`/`completed_at`, `error_message`, `export_format`/`export_bytes`/
  `row_count`/`recipient_count`, `delivery_status`, `triggered_by`.
- **`data_exports`** (migration `0030_superadmin_hardening.sql`): super-admin
  summary export log (`kind`, `status`, `summary` JSONB — counts only).
- Delivery reuses **`messages`** / **`message_recipients`** (migration `0018`).

## 6. Permissions / RBAC involved

- Reports Center: `reports:center:read`, `reports:center:export`, plus each
  report's own key (`reports:attendance:read`, `reports:fees:read`,
  `reports:exams:read`, `reports:homework:read`, `college:read`,
  `library:reports`, `transport:reports`, `hostel:reports`,
  `inventory:reports`, `payroll:reports`, etc.).
- Scheduled Reports (seeded `0038`): `scheduled_reports:read|create|update|delete|run|history|manage`.
  admin = all; accountant = all except `manage`; teacher = read/create/run/history;
  student/parent = none.
- `super_admin` bypasses checks.

## 7. Tenant isolation notes

- Every report's SQL is parameterized with `institution_id`; export and schedule
  CRUD all scope by tenant.
- **No access widening:** a scheduled report can only be created over a saved
  report the creator can see, and the creator must hold the underlying report's
  permission (`assertReportUsable` -> `getSaved` + `runSaved`).
- **Delivery is permission-filtered:** recipients are reduced to those who hold
  the underlying report's permission (`authorizedRecipients`), so report data
  never reaches an unauthorized user.
- A run always records a row even on failure (deleted saved report -> recorded
  `failed`; no valid creator -> recorded `skipped`), so nothing leaks.

## 8. Key workflows

1. **Run a report:** `GET /report-center/{key}` with filters
   (section/date range/exam/etc.) -> `{ title, columns, rows }`; export via
   `/export?format=csv|pdf`.
2. **Schedule:** create a schedule over a saved Custom Report with cadence, run
   time + timezone, recipients, channels, export format. `next_run_at` is computed
   from the cadence (`computeNextRun`).
3. **Manual run:** `POST /:id/run` executes as the caller (you can only generate
   what you can see) and records run history.
4. **Automated run:** the job worker's scheduler tick enqueues a
   `scheduled_report_run` job (deduped per schedule+window) for each due schedule
   and advances `next_run_at`; the worker calls
   `executeScheduledById(scheduleId, institutionId)`, which runs the schedule **as
   its creator**. `POST /run-due` is the equivalent HTTP tick. (Worker gated by
   `JOB_WORKER_ENABLED`; see [job queue workflow](../MODULE_WORKFLOWS.md).)
5. **Deliver:** in-app message to authorized recipients and/or best-effort email
   (`dispatchExternal`, a no-op when SMTP is unconfigured).

## 9. Test coverage summary

- `backend/tests/integration/reportcenter.int.test.ts` — list reports; run
  attendance/fee-collection/fee-dues/exam/homework reports; CSV + PDF export with
  correct MIME/content; permission guards (student lacks center read, teacher
  lacks fees read, accountant lacks attendance read); cross-institution isolation.
- `backend/tests/integration/scheduledreports.int.test.ts` — schedule CRUD;
  enable/disable; manual run with CSV/PDF; run history fields; email degrades when
  SMTP unconfigured; `scheduled_reports:manage` guard; recipient filtering by
  underlying permission; `run-due`; student/parent blocked; cross-tenant denial.
- Run via `npm run test:integration`.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| 403 running a report | Missing the report's own permission (not just `reports:center:read`) | Grant e.g. `reports:fees:read` for fee reports |
| Export 403 | Has the report permission but lacks `reports:center:export` | Grant `reports:center:export` |
| Report returns empty rows | Filters too narrow, or a Phase B/D report on a tenant without that module set up | Adjust filters; college/library/etc. reports are empty unless that data exists |
| Scheduled report never runs automatically | `JOB_WORKER_ENABLED` not `true`, or no scheduler tick | Enable the worker, or call `POST /run-due` / `/jobs/run-scheduler` |
| Run recorded `failed` with "saved report no longer exists" | The linked Custom Report was deleted (`report_id` set NULL) | Recreate/relink the saved report |
| Run `skipped` "No valid creator" | The schedule's `created_by` user is gone | Recreate the schedule under a valid user |
| Recipients didn't receive it | Recipients lack the underlying report's permission, or email/SMTP unconfigured | Add authorized recipients; configure SMTP for email |

## 11. Future enhancement notes

- Generated CSV/PDF artifacts are currently sized/delivered but not persisted as
  downloadable files in `documents`; attaching the artifact is a natural addition.
- `run_time` is interpreted as UTC HH:MM (timezone stored for intent only);
  full timezone-aware scheduling could be added.
- More canned reports and per-report saved filters continue to be added; the
  [Custom Report Builder](./custom-report-builder-module.md) covers ad-hoc needs.
