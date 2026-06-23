# Observability Module

> **Status:** Implemented · **Backend:** `backend/src/modules/observability` (+ app health probes in `backend/src/app.ts`) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md) · [Deployment](../DEPLOYMENT.md)

## 1. Purpose

Operational visibility for the platform. It has two layers:

1. **Public health probes** (`/health`, `/ready`, `/live`) mounted at the app root
   — cheap, secret-free checks for load balancers / k8s probes.
2. **Protected platform observability** (`/api/v1/observability/*`) — Prometheus
   metrics, a detailed health view, and an aggregated overview, all super-admin
   only. Counters (requests, errors, durations, jobs, scheduled reports, backups,
   restores, cache) are in-process; gauges (queue depth, stored-backup count, last
   backup time) are read live from Postgres.

## 2. User roles involved

- **Anonymous / probes** — `/health`, `/ready`, `/live` need no authentication.
- **super_admin** — the only role granted `observability:*`; reaches metrics,
  detailed health, and the overview.
- All tenant roles (admin/teacher/accountant/student/parent) get 403 on the
  protected observability endpoints (verified in tests).

## 3. Main screens / pages

- **Super Admin → Observability:**
  `frontend/src/app/(dashboard)/super-admin/observability/page.tsx` — renders the
  `/observability/overview` summary (requests/errors, jobs, queue, scheduled
  reports, cache, backups, recent failures, worker status).
- **Super Admin → Health:**
  `frontend/src/app/(dashboard)/super-admin/health/page.tsx` — detailed health.

## 4. Main backend APIs

Public probes (app root, no auth):

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/health` | Liveness + Postgres/Mongo reachability + uptime (503 if DB down) | public |
| GET | `/ready` | Readiness — DB + migrations critical, others reported (503 until ready) | public |
| GET | `/live` | Cheapest "process is up" probe | public |

Protected platform observability (`/api/v1/observability`, `authenticate` + permission):

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/observability/metrics` | Prometheus text exposition (requests, errors, durations, jobs, queue, scheduled reports, cache, backups, restores) | `observability:metrics` |
| GET | `/observability/health` | Detailed health (Postgres/Mongo, migrations, queue depth, worker/storage config) | `observability:health` |
| GET | `/observability/overview` | Aggregated overview + recent job failures | `observability:read` |

> **Live-VPS note:** behind the production nginx, **only `/health` is exposed
> publicly** — `/ready` and `/live` return 404 through the proxy (they still work
> when hitting the app directly). Health checks / probes against the live VPS
> should target `/health`. See [Deployment](../DEPLOYMENT.md).

## 5. Database tables / entities

The module owns **no tables of its own**. It reads from existing tables for live
gauges and the overview:

- `schema_migrations` — applied-migration count (readiness + health).
- `jobs` — queue depth grouped by status; recent `failed` jobs for the overview.
- `scheduled_report_runs` — scheduled-report run counts by status.
- `backups` — last successful backup time + stored-backup count.

In-process counters live in `backend/src/observability/metrics.ts`
(`snapshot()`, `recordBackup`, `recordRestore`, etc.); cache stats come from
`backend/src/cache/cache.ts`. Permission keys are seeded in
`0041_observability.sql`.

## 6. Permissions / RBAC involved

Seeded in `0041_observability.sql` and granted **only** to `super_admin`:
`observability:read`, `observability:metrics`, `observability:health`,
`observability:logs` (the last is reserved — logs ship to stdout). No tenant role
receives any `observability:*` key.

## 7. Tenant isolation notes

Observability is a **platform-wide** view, intentionally cross-tenant, and is
restricted to super-admin via the permission keys (not tenant-scoped). The public
probes and all observability responses are scrubbed of secrets: the structured
access log (`buildAccessLog`) drops query strings (so a `?token=` never lands in
logs) and emits only curated fields; readiness/health/metrics bodies are asserted
to contain no `password|secret|token` in tests.

## 8. Key workflows

1. **Liveness/readiness probing** — orchestrators call `/health` (and `/ready`
   where exposed). `/ready` fails only on critical deps (DB + migrations); optional
   deps (job queue, storage) are reported but never fail readiness.
2. **Metrics scraping** — a Prometheus scraper (authenticated as super-admin) hits
   `/observability/metrics`; counters are merged with live DB gauges into the text
   exposition (`http_requests_total`, `jobs_processed_total`, `jobs_queue_depth`,
   `backups_total`, `restores_total`, `backups_stored`,
   `backup_last_success_timestamp_seconds`, cache counters, etc.).
3. **Overview / health dashboards** — the super-admin console reads
   `/observability/overview` and `/observability/health` to surface request/error
   rates, average duration, job + queue + scheduled-report state, cache stats,
   backup gauges, recent failures, and worker config.

## 9. Test coverage summary

`backend/tests/integration/observability.int.test.ts` covers: correlation-id
generation + preservation (`x-request-id`); the structured access log emitting
only safe fields and dropping query strings/secrets; anonymous requests omitting
user context; `/health` liveness and `/ready` readiness with DB + migration
checks and no secrets; Prometheus metrics exposed to super-admin (request + job
counters) with no secrets; **permission-gating all three protected endpoints
(tenant admin/student/parent → 403)**; job-failure metric increment; and the
detailed super-admin health view without secrets. (`backups.int.test.ts`
additionally asserts backup/restore metrics and the overview backup gauges.)

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `/ready` or `/live` returns 404 on the live VPS | nginx exposes only `/health` publicly in production | Use `/health` for external probes; hit the app directly for `/ready` / `/live` |
| `/observability/*` returns 403 for a tenant admin | No tenant role holds `observability:*` | Expected — these are super-admin only |
| `/health` returns 503 | Postgres unreachable | Check DB connectivity/credentials; `postgres:false` in the body |
| `/ready` returns 503 with `migrations:false` | Migrations not applied | Run `npm run migrate` before serving traffic |
| Metrics counters reset to 0 | Counters are in-process | Expected on process restart; scrape frequently or use the DB gauges for durable values |
| Queue depth looks empty in metrics | `JOB_WORKER_ENABLED` off / no jobs | Enable the worker; gauges read `jobs` live from the DB |

## 11. Future enhancement notes

- Persistent metrics backend (the counters are per-process and reset on restart).
- Expose `/ready` / `/live` through the production proxy for richer orchestration.
- Wire `observability:logs` to a real log query surface (currently reserved).
- Alerting on `backup_last_success_timestamp_seconds` staleness and error rates.
- Items marked "(to confirm)": none — behaviour maps to `observability.routes.ts`,
  `observability.service.ts`, the app-root probes in `app.ts`, and the tests.
