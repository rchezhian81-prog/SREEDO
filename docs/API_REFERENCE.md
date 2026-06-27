# API Reference — SRE EDU OS

Deliverable **#3 API list**. The **live, authoritative** contract is the
generated Swagger at `/api/docs` (JSON at `/api/docs.json`). This document lists
the **current endpoints** (exact, from the route files) and the **planned
endpoints** per upcoming module.

- **Base path:** `/api/v1`
- **Auth:** `Authorization: Bearer <accessToken>` (15-min JWT). Refresh via
  `POST /auth/refresh`.
- **Validation:** every body/query is zod-validated; failures return a 400 with a
  consistent error envelope from the central error handler.
- **Rate limiting:** global limiter on all `/api/v1`; stricter limiter on login.
- **Errors:** `{ error: { message, ... } }` via `ApiError` + error middleware.
- **Owner-scoping:** staff roles see all records; `student` is limited to their
  own student/attendance/exam/fee records; section rosters, exam-wide results,
  the fee summary and dashboard stats are staff-only.
- **Health (outside /api/v1):** `GET /health` → `{ status, postgres, mongo, uptime }`.

Auth column legend: **public** · **auth** (any logged-in) · or explicit role(s).

---

## Part 1 — Current endpoints

### Auth — `/api/v1/auth`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/login` | public (rate-limited) | Email+password → access + refresh tokens |
| POST | `/refresh` | public | Rotate refresh token → new tokens |
| POST | `/logout` | public | Revoke a refresh token |
| GET | `/me` | auth | Current user profile |
| POST | `/change-password` | auth | Change password (revokes all sessions) |

### Users — `/api/v1/users` *(admin only, whole router)*
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List user accounts |
| POST | `/` | Create account |
| GET | `/:id` | Get account |
| PATCH | `/:id` | Update account |
| DELETE | `/:id` | Delete account |

### Students — `/api/v1/students`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List (search + pagination) |
| POST | `/` | admin | Create (auto admission no.) |
| GET | `/:id` | auth | Get student |
| PATCH | `/:id` | admin | Update |
| DELETE | `/:id` | admin | Archive (soft delete); `?hard=true` to permanently delete |

### Teachers — `/api/v1/teachers`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List |
| POST | `/` | admin | Create (auto employee no.) |
| GET | `/:id` | auth | Get |
| PATCH | `/:id` | admin | Update |
| DELETE | `/:id` | admin | Delete |

### Academics — `/api/v1` *(read: auth; write: admin)*
| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/academic-years` | List / create academic years |
| GET / POST | `/classes` | List / create classes |
| DELETE | `/classes/:id` | Delete class |
| POST | `/sections` | Create section |
| DELETE | `/sections/:id` | Delete section |
| GET / POST | `/subjects` | List / create subjects |
| DELETE | `/subjects/:id` | Delete subject |

### Attendance — `/api/v1/attendance`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | View by section + date |
| POST | `/` | admin, teacher | Bulk upsert for a section/date |
| GET | `/students/:studentId` | auth | Per-student history |

### Exams — `/api/v1/exams`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | auth | List exams |
| POST | `/` | admin | Create exam |
| GET | `/:id/results` | auth | Results for an exam |
| POST | `/:id/results` | admin, teacher | Bulk upsert results |
| GET | `/students/:studentId/report` | auth | Per-student report |

### Fees — `/api/v1/fees` *(write: admin, accountant)*
| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/structures` | List / create fee structures |
| GET / POST | `/invoices` | List / create invoices |
| GET | `/invoices/:id` | Invoice detail |
| POST | `/invoices/:id/payments` | Record payment (overpay-guarded) |
| GET | `/summary` | Fee summary (collected/pending) |
| GET | `/invoices/:id/breakdown` | Base / fines / discounts / outstanding (owner-scoped) |

**Fee Management Depth** *(`fee_categories\|fee_schedules\|fee_fines\|fee_discounts:*`, `fee_reports:read`)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET/POST · PATCH/DELETE | `/categories` · `/categories/:id` | `fee_categories:read\|create\|update\|delete` | Fee categories |
| GET/POST · PATCH | `/schedules` · `/schedules/:id` | `fee_schedules:read\|create\|update` | Term-wise fee schedules |
| GET · POST | `/schedules/:id/preview` · `/schedules/:id/generate` | `fee_schedules:generate` | Preview targets / generate invoices (idempotent) |
| GET/POST · POST | `/fine-rules` · `/invoices/:id/fines` · `/fines/apply-overdue` | `fee_fines:read\|apply` | Fine rules + apply late fines |
| POST | `/applied-fines/:id/waive` | `fee_fines:waive` | Waive an applied fine |
| GET/POST · POST | `/discounts` · `/invoices/:id/discounts` | `fee_discounts:read\|apply` | Discounts/scholarships + apply |
| POST | `/applied-discounts/:id/approve` | `fee_discounts:approve` | Approve an applied discount |
| GET | `/report-center/fee_*` | `fee_reports:read` | Dues/collection reports (Reports Center) |

### Online Payments — `/api/v1/online-payments` *(tenant-scoped; `online_payments:*`; degrades to 503 when the gateway is unconfigured/disabled)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| POST | `/webhook` | none (HMAC-verified) | Gateway webhook — signature-verified, idempotent; credits the invoice on success |
| GET / PATCH | `/settings` | `online_payments:settings` | Gateway status (no secrets) / enable-disable per institution |
| GET | `/` | `online_payments:read` | List orders (owner-scoped for student/parent) |
| POST | `/` | `online_payments:create` | Create an order for a pending invoice (server-computed amount → hosted checkout) |
| GET | `/:id` | `online_payments:read` | Order detail (owner-scoped) |
| GET | `/:id/receipt` | `online_payments:read` | Fee-receipt PDF after success (owner-scoped) |
| POST | `/:id/refund` | `online_payments:refund` | Gateway refund initiation |

### Transfer Certificates — `/api/v1/transfer-certificates` *(tenant-scoped; `transfer_certificates:*`; owner-scoped for student/parent)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/` | `transfer_certificates:read` | TC register (status/studentId/search; owner-scoped) |
| POST | `/` | `transfer_certificates:create` | Create a TC draft (snapshots student, assigns TC no) |
| GET | `/student/:studentId/dues` | `transfer_certificates:read` | Pending fees/library/transport/hostel dues |
| GET | `/:id` | `transfer_certificates:read` | TC detail (owner-scoped) |
| PATCH | `/:id` | `transfer_certificates:update` | Edit a draft |
| POST | `/:id/issue` | `transfer_certificates:issue` (+ `:override_dues` to bypass dues) | Issue a TC |
| POST | `/:id/cancel` | `transfer_certificates:cancel` | Cancel a TC |
| GET | `/:id/download` | `transfer_certificates:download` | TC PDF (student/parent: issued only) |
| GET | `/report-center/tc_*` | `transfer_certificates:read` | TC reports (Reports Center) |

### Threaded Messaging — `/api/v1/communication/threads` *(tenant + participant-scoped; `threads:*`)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/threads` | `threads:read` | My threads (with unread counts) |
| POST | `/threads` | `threads:create` | Start a thread (one-to-one/group; same-institution participants) |
| GET | `/threads/unread-count` | `threads:read` | Total unread across my threads |
| GET | `/threads/:id` | `threads:read` | Thread detail (participant-only; 404 otherwise) |
| POST | `/threads/:id/messages` | `threads:reply` | Reply (notifies others, best-effort) |
| POST | `/threads/:id/read` | `threads:read` | Mark thread read for me |
| POST | `/threads/:id/participants` | `threads:manage` | Add participants |
| DELETE | `/threads/:id` | `threads:delete` | Archive the thread for me |
| GET | `/report-center/thread_*` | `threads:reports` | Messaging reports (Reports Center) |

### Announcements — `/api/v1/announcements` *(write: admin, teacher)*
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List (audience-filtered) |
| POST | `/` | Create |
| GET | `/:id` | Get |
| PATCH | `/:id` | Update |
| DELETE | `/:id` | Delete |

### Dashboard — `/api/v1/dashboard`
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/stats` | auth | KPI counts for dashboard cards |

### AI — `/api/v1/ai` *(admin, teacher, accountant; 503 without OpenAI key)*
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/assistant` | Ask the GPT-4o assistant (grounded in live stats) |
| GET | `/conversations` | List conversation history |
| GET | `/conversations/:id` | Get a conversation |

### AI Insights — `/api/v1/ai-insights` *(tenant-scoped; `ai:*` permissions; metrics always returned, narrative only when OpenAI configured)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/dashboard` | `ai:read` | Headline KPIs + workflow suggestions |
| GET | `/summary/:report` | `ai:summarize` | KPI summary for a report (attendance, fees, exams, homework, payroll, library, transport, hostel, inventory) |
| GET | `/risk/attendance` | `ai:risk_alerts` | Low-attendance students over a window (`threshold`, `windowDays`) |
| GET | `/risk/fees` | `ai:risk_alerts` | Overdue + outstanding invoices (manual reminder only) |
| GET | `/search` | `ai:document_search` | Semantic document search (keyword fallback); `q` required |
| GET | `/suggestions` | `ai:workflow_suggestions` | Deterministic workflow suggestions |

### Custom Report Builder — `/api/v1/custom-reports` *(tenant-scoped; `custom_reports:*`; running/exporting also re-checks the underlying report's own permission)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/sources` | `custom_reports:read` | Available report sources (Reports Center registry) |
| GET | `/` | `custom_reports:read` | List saved reports (shared + mine) |
| POST | `/` | `custom_reports:create` | Create a saved definition (shared needs `:share`) |
| POST | `/preview` | `custom_reports:run` | Ad-hoc run without saving (underlying permission enforced) |
| POST | `/export` | `custom_reports:export` | Ad-hoc export CSV/PDF (`?format=csv\|pdf`) |
| GET | `:id` | `custom_reports:read` | Get a definition (private: creator-only, else 404) |
| PATCH | `:id` | `custom_reports:update` | Edit (creator/admin; shared needs `:share`) |
| DELETE | `:id` | `custom_reports:delete` | Delete (creator/admin) |
| POST | `:id/duplicate` | `custom_reports:create` | Duplicate as a private copy |
| GET | `:id/run` | `custom_reports:run` | Run a saved report (underlying permission enforced) |
| GET | `:id/export` | `custom_reports:export` | Export a saved report CSV/PDF (`?format=csv\|pdf`) |

### Disciplinary Records — `/api/v1/disciplinary` *(tenant-scoped; `disciplinary:*`; student/parent read is owner-scoped via the portal only)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/` | `disciplinary:read` | Incident register (filter: status, severity, studentId, category, dateFrom/dateTo, search) |
| POST | `/` | `disciplinary:create` | Log an incident (snapshots the student) |
| GET | `/settings` | `disciplinary:read` | Portal-visibility setting `{ portalEnabled }` |
| PATCH | `/settings` | `disciplinary:update` | Enable/disable portal visibility (OFF by default) |
| GET | `/student/:studentId` | `disciplinary:read` | A student's disciplinary history |
| GET | `:id` | `disciplinary:read` | Record detail |
| PATCH | `:id` | `disciplinary:update` | Edit details (open records only) |
| DELETE | `:id` | `disciplinary:delete` | Hard-delete (entered wrongly) |
| GET | `:id/actions` | `disciplinary:read` | Audit timeline |
| POST | `:id/review` | `disciplinary:action` | Mark under review |
| POST | `:id/action` | `disciplinary:action` | Record action taken (→ action_taken) |
| POST | `:id/close` | `disciplinary:close` | Close a record |
| POST | `:id/cancel` | `disciplinary:delete` | Cancel a record (retained for audit) |
| GET | `/portal/students/:studentId/disciplinary` | `disciplinary:portal_read` | Own / linked-child records (only when portal visibility enabled; owner-scoped) |
| GET | `/report-center/disciplinary_*` | `disciplinary:reports` | Disciplinary reports (Reports Center) |

### Scheduled Reports — `/api/v1/scheduled-reports` *(tenant-scoped; `scheduled_reports:*`; generation re-checks the underlying Custom Report's permission; recipients filtered to authorised users)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/` | `scheduled_reports:read` | List schedules (with last-run summary) |
| POST | `/` | `scheduled_reports:create` | Create a schedule for a saved Custom Report |
| POST | `/run-due` | `scheduled_reports:manage` | Process due schedules (scheduler tick; runs each as its creator) |
| GET | `:id` | `scheduled_reports:read` | Get a schedule |
| PATCH | `:id` | `scheduled_reports:update` | Edit / enable / disable |
| DELETE | `:id` | `scheduled_reports:delete` | Delete a schedule |
| POST | `:id/run` | `scheduled_reports:run` | Run now (as the caller; records run history) |
| GET | `:id/runs` | `scheduled_reports:history` | Run history (`?limit=`) |

### Background Jobs — `/api/v1/jobs` *(`jobs:*`; admin = own institution, super_admin = platform-wide; other roles denied)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/` | `jobs:read` | List jobs (filters: status, type, institutionId, date range; scoped) |
| POST | `/run-scheduler` | `jobs:run_scheduler` | Scheduler tick — enqueue due scheduled reports (`{ due, enqueued }`) |
| POST | `/process` | `jobs:manage` | Drain the worker queue now (`{ processed, success, failed, retried }`; scoped) |
| GET | `:id` | `jobs:read` | Job detail (scoped; 404 out of scope) |
| POST | `:id/retry` | `jobs:retry` | Retry a failed job |
| POST | `:id/cancel` | `jobs:cancel` | Cancel a pending job |

### Observability
*Public probes (no auth; no secrets / tenant data):*
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness (postgres + mongo + uptime) |
| GET | `/live` | Cheapest liveness ("process is up") |
| GET | `/ready` | Readiness — 503 until critical deps (DB + migrations) ready; optional deps reported |

*Protected — `/api/v1/observability` (super-admin only; `observability:*`):*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/metrics` | `observability:metrics` | Prometheus text (requests/errors/durations, job + scheduled-report counters, queue depth, **cache** hits/misses/invalidations + entries) |
| GET | `/health` | `observability:health` | Detailed health (DB/Mongo, migrations, queue depth, config) |
| GET | `/overview` | `observability:read` | Overview (request/error summary, jobs + queue, scheduled-report delivery, **cache** counters, recent failures, worker status) |

*Every response carries an `x-request-id` correlation header (honoured from the request or generated).*

**Hot-path caching:** a per-instance in-process TTL cache fronts the **dashboard
stats** (`GET /dashboard/stats`, keyed by `institution_id`, 30 s TTL, invalidated
on student writes) and the super-admin **RBAC catalogue/matrix** (`GET /platform/permissions`,
`GET /platform/roles`, 60 s TTL, dropped on grant/revoke). No new endpoints; cache
counters surface via `/observability/metrics` (`cache_hits_total`, `cache_misses_total`,
`cache_invalidations_total`, `cache_entries`) and the `cache` block of `/observability/overview`.

### Internationalization (i18n)
The **web frontend** is multi-language (English default + Tamil; switcher persisted per
browser). The **API contract is unchanged and English-stable** — error messages, field
names, and payloads are not localized. The frontend owns presentation: it maps its own
fallback messages (e.g. network errors) to translated UI strings and falls back to English
for any missing translation. PDFs/reports are not localized this round.

### Accessibility (WCAG 2.1 AA)
A web-frontend baseline a11y pass (keyboard focus, reduced motion, skip links, landmarks,
labelled controls, accessible dialog, status/alert roles). **No API or contract changes** —
backend responses are unaffected.

### Load / Performance Testing
A load-testing suite (`backend/perf/`, autocannon) exercises the existing hot endpoints
(auth, dashboard stats, students/staff lists, attendance, fees summary, Reports Center,
timetable, RBAC) and reads `/observability/metrics` for cache/latency counters. **No new
endpoints or contract changes** — it only drives existing routes. See
[`PERFORMANCE.md`](./PERFORMANCE.md).

### Contract testing
This spec is **contract-tested** in CI (`backend/tests/integration/contract.int.test.ts`):
the generated OpenAPI document is checked for validity + group coverage, representative
endpoints are asserted to return documented status codes, and the security guarantees
(401 unauth, 403 role/owner, 404 cross-tenant, portal cookie auth) are verified. The spec
itself is unchanged by this — see [`E2E_TESTING.md`](./E2E_TESTING.md).

### Production deployment
In production (`docs/DEPLOYMENT.md`) the API sits behind Nginx (TLS) with the public probes
`GET /health`, `/ready`, `/live` (no auth, no secrets) wired to monitoring + the container
healthcheck; the super-admin `/observability/metrics|overview` surfaces request/cache/job/
backup metrics. The API contract is **unchanged** by deployment — Swagger stays off
(`ENABLE_API_DOCS=false`), CORS is restricted to `CORS_ORIGIN`, rate limiting + upload limits
apply, and portal cookies are `secure` + `httpOnly` over HTTPS.

### Backups — `/api/v1/backups` *(super-admin only — `authorize("super_admin")` + `backup:*`; tenant users denied; storage paths never exposed)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/` | `backup:read` | List backups (metadata only; `?scope`/`?status`/`?institutionId`/`?limit`) |
| POST | `/` | `backup:create` | Trigger a manual backup now (`{ scope, institutionId? }`; 201) |
| GET | `/settings` | `backup:read` | Retention + automatic-schedule settings |
| PATCH | `/settings` | `backup:manage` | Update retention (`retentionCount` null = off) + schedule |
| GET | `/{id}` | `backup:read` | One backup's metadata |
| DELETE | `/{id}` | `backup:manage` | Delete a backup + its artifact (audited) |
| GET | `/{id}/download` | `backup:download` | Download the gzipped artifact (protected, audited) |
| GET | `/{id}/restore/preview` | `backup:restore` | Non-destructive preview (scope, schema match, per-table rows) |
| POST | `/{id}/restore` | `backup:restore` | Restore a global backup (`{ confirm, force? }`; destructive, audited) |

*Backups are portable logical snapshots stored in object storage (or local-disk fallback);
the raw `storage_key` is never returned. Restore is **global-only**, requires `confirm=true`
(and `force=true` in production), runs transactionally, and writes `restore.start` +
`restore.success`/`restore.failed` to the platform audit log. Backup/restore counters are on
`/observability/metrics` (`backups_total`, `restores_total`, `backups_stored`,
`backup_last_success_timestamp_seconds`).*

### Platform (Super Admin) — `/api/v1/platform` *(super-admin only — `authorize("super_admin")` + `platform:*`; tenant users denied; cross-tenant data lives only here)*
| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/kpis` | `platform:usage_read` | Platform-wide KPIs + module adoption |
| GET | `/health` | `platform:health_read` | Platform health (DB/Mongo/counts/uptime) |
| GET | `/audit` | `platform:audit_read` | Durable cross-tenant audit log (filters: institutionId, actorId, action, targetType, date range) |
| GET | `/institutions` | `platform:read` | Institutions with status + usage |
| POST | `/institutions` | `platform:manage_institutions` | Create an institution (audited) |
| GET | `/institutions/:id` | `platform:read` | Institution detail (profile + limits + usage) |
| PATCH | `/institutions/:id` | `platform:manage_institutions` | Update profile/type (audited) |
| POST | `/institutions/:id/suspend` | `platform:manage_institutions` | Suspend (audited) |
| POST | `/institutions/:id/activate` | `platform:manage_institutions` | Activate (audited) |
| POST | `/institutions/:id/subscription` | `platform:manage_subscriptions` | Assign package (audited) |
| PATCH | `/institutions/:id/limits` | `platform:manage_subscriptions` | Set per-institution limits (audited) |
| POST | `/impersonate` | `platform:impersonate` | Start a support session (audited; scoped token; no secrets) |
| GET | `/permissions` | `platform:permissions_read` | Permission catalogue grouped by module (with roles holding each) |
| GET | `/roles` | `platform:rbac_read` | Role → permission matrix |
| POST | `/roles/:role/permissions` | `platform:rbac_manage` | Grant a permission to a role (cache-invalidated + audited) |
| POST | `/roles/:role/permissions/revoke` | `platform:rbac_manage` | Revoke a permission (protects super_admin's `platform:*`; audited) |

---

## Part 2 — Planned endpoints (by phase)

Naming follows the existing conventions (plural nouns, nested resources, bulk
upsert where natural). Each ships with `@openapi` JSDoc so Swagger stays current.

### Phase A — Super Admin & permissions
- `/institutions` CRUD · `/institutions/:id/branches` CRUD
- `/packages` CRUD · `/institutions/:id/subscription`
- `/permissions` (list) · `/roles/:role/permissions` (grant/revoke)
- `/admin/audit-logs` (read) · `/admin/backups` (trigger/list/restore)
- `/settings` (institution settings get/patch)

### Phase B — College mode & timetables
- `/departments`, `/courses`, `/semesters` CRUD
- `/rooms`, `/periods` CRUD
- `/timetables` (per section) · `/timetables/teacher/:id` · conflict check on write
- `/grade-bands` CRUD (for report cards)

### Phase C — Portals, homework, communication, uploads
- `/homework` CRUD · `/homework/:id/submissions` (submit/grade)
- `/me/children` (parent) · `/me/attendance`, `/me/results`, `/me/fees` (scoped)
- `/messages` (internal messaging) · `/notifications` (list/read)
- `/devices` (register FCM token) · `/notify` (admin push/SMS/email send)
- `/uploads` (pres?/signed object-storage URLs) · `/documents` CRUD
- Receipt + report-card PDF: `/fees/invoices/:id/receipt.pdf`,
  `/exams/:id/students/:sid/report-card.pdf`

### Phase D — Operations modules
- **Library:** `/library/books`, `/library/loans` (issue/return), `/library/fines`
- **Transport:** `/transport/vehicles`, `/drivers`, `/transport/routes`,
  `/transport/allocations`
- **Hostel:** `/hostels`, `/hostels/:id/rooms`, `/hostel/allocations`
- **Inventory:** `/inventory/items`, `/vendors`, `/inventory/purchases`,
  `/inventory/issues`
- **Payroll:** `/payroll/salary-structures`, `/payroll/runs`,
  `/payroll/payslips`, `/staff/attendance`, `/staff/leaves`

### Cross-cutting (Reports — deliverable spans modules)
- `/reports/<area>` with `format=csv|pdf` query for export/print
- `/reports/custom` (saved custom report definitions) — Phase D

> Status of each endpoint maps to the module status in [`PRD.md`](./PRD.md) §4 and
> the phasing in [`DEV_ROADMAP.md`](./DEV_ROADMAP.md). Role gates per endpoint
> follow the matrix in [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md).
