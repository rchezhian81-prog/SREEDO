# Development Roadmap — SRE EDU OS

Covers deliverables **#8 Development phases**, **#9 Testing plan**, and **#10
Deployment plan**. Status reflects 2026-06-18. The operational run/deploy
walkthrough also exists as `docs/ROADMAP.html`; this is the engineering plan.

---

## Part 1 — Development phases (#8)

Phasing is sequenced so each phase is shippable and the riskiest cross-cutting
work (multi-tenancy, permissions, security hardening) comes first.

### Phase 0 — MVP ✅ DONE (baseline)
Auth + RBAC, admin dashboard, students, teachers, academics, attendance, fees,
exams (API), announcements, AI assistant, Swagger, seed, Docker, CI, unit tests.
*This satisfies the brief's MVP list.*

### Phase A — Foundation hardening & multi-tenancy 🟡 IN PROGRESS
**Goal:** make the platform truly multi-institution and production-safe.
1. **Security backlog (handover §8):** ✅ owner-scoped reads, ✅ soft-delete
   students, ✅ invoice `amount_paid`, ✅ sequence-based numbering, ✅ Swagger
   off in production, ✅ **httpOnly-cookie tokens** (shipped with the portal —
   `authenticate` reads a Bearer header for staff or the cookie for the portal) —
   all done.
2. **Permissions layer:** ✅ `permissions` + `role_permissions` (migration
   `0012`), `requirePermission()` middleware with a cached role→permission map,
   seeded role matrix, `GET /auth/permissions`, and `super_admin` bypass. The
   users module is wired to it; remaining routes migrate from `authorize(...)`
   to `requirePermission(...)` incrementally.
3. **Multi-tenancy:** ✅ `institutions`/`branches`/`subscription_packages`/
   `institution_subscriptions` + `super_admin` role (migration `0011`);
   `institution_id` added/backfilled/indexed on all tenant tables (`0013`) and
   set `NOT NULL` (`0014`); tenant context in the JWT + `/auth/me`; a
   `requireTenant` middleware; and **per-module query scoping** so every module
   filters by the caller's `institution_id`. Cross-tenant isolation is proven by
   integration tests. (Done in a dedicated follow-up PR after Phase A merged.)
4. **Super Admin panel:** ✅ backend CRUD + web console (`/super-admin`:
   institutions, branches, packages, subscriptions) and ✅ **hardening**
   (migration `0030`, `/admin/*`): global institution settings + feature
   flags/modules, **plan-limit enforcement**, a global **audit-log viewer**
   (Mongo, CSV, graceful), safe **data export** + history, read-only
   **cross-tenant snapshot**, and **system health**. Remaining: scheduled
   backup/restore automation, global user-role management.
5. ✅ **MVP UI gaps filled:** Exams & Results page and Users/account-management
   page shipped.

### Phase B — Academic depth (college mode + timetables) ✅
1. **College mode:** ✅ departments, programs/courses, semesters, academic
   batches, course-/semester-wise subjects (with credits), student enrollment,
   and staff allocation (migration `0023`) — tenant-scoped, permission-guarded
   (`college:*`, `departments:*`, `programs:*`, `semesters:*`). Semester-tagged
   exams + a **GPA/CGPA** foundation (grade-band `grade_point`, credit-weighted)
   with owner-scoped student semester-result / CGPA views. Institutions switch
   between school and college mode per `type` (school flow unchanged); web UI
   shipped (`/college`). Additive, school-safe columns on `exams`,
   `fee_structures`, `grade_bands`, and `timetable_entries`.
2. **Timetable:** ✅ period & room masters, per-section timetable entries,
   teacher/room/section **conflict checking** (service 409s + race-safe partial
   unique indexes, migration `0015`), teacher-timetable view, CSV export, and
   `timetable:*` permissions. Tenant-scoped; web UI shipped (`/timetable`).
3. **Grading:** ✅ grade-band scale (migration `0017`), total/%/grade computation,
   and **report-card + mark-sheet PDFs** (pdfkit) generated from exam results —
   owner-scoped, permission-guarded, with a staff Reports page + portal download.

### Phase C — Engagement (portals, homework, comms, AI+) ⬜
1. **Object storage** ✅ — S3-compatible adapter (local-disk fallback), document
   metadata table (migration `0019`), validated/safe-named uploads, protected
   owner-scoped downloads, `documents:*` + `institution:logo:update` permissions,
   and upload/list/download/delete UI (staff + portal). ID-card/photo/cert/TC +
   message-attachment foundations included.
2. **PDFs:** ✅ **report cards**, **mark sheets**, **fee receipts**, and **student/
   staff ID cards** (incl. bulk section export) shipped on a shared pdfkit utility
   (migration `0021` adds `fee_receipts:*` / `id_cards:*` permissions). Remaining:
   transfer certificates.
3. **Communication:** ✅ in-app messaging (audience targeting + read/unread inbox),
   **email/SMS/FCM-push** adapters (optional, graceful), device-token registration,
   **fee reminders** + **absence alerts** (migration `0018`). ✅ **Threaded
   messaging** — conversation **threads** (one-to-one + group), replies, and
   **per-participant read state** (unread counts, mark-read) with strict
   participant-scoped access, same-institution participant validation, best-effort
   reply notifications (reuse the channel adapters), archive, and 4 messaging
   reports (migration `0035`, `/communication/threads`, `threads:*`). Legacy
   inbox untouched.
4. **Parent & Student portals** — ✅ base shipped (web): cookie auth (`/auth/portal/*`),
   `guardians` parent⇄child links (migration `0016`), `/portal/*` owner-scoped
   endpoints, and portal UI (dashboard, profile, attendance, timetable, fees,
   notices, child selector). ✅ **Mobile parity (Phase 1)** — the Flutter app now
   delivers the parent/student experience on mobile (Bearer auth via `/auth/login`
   with refresh + graceful expiry, role-aware shell with a parent child-selector,
   dashboard, attendance, fees + **Pay Online** via the gateway + receipt,
   homework view/submit, announcements + inbox, documents/report-card/ID-card
   PDFs, profile, best-effort FCM token registration). ✅ **Mobile parity
   (Phase 2)** — the **staff** experience: permission-gated dashboard hub
   (`auth.can(...)` from `/auth/permissions`) with KPI cards + action tiles to
   mark **attendance**, enter **exam marks**, create/review **homework**, send/
   read **communication**, view **my timetable**, run **reports**, download **my
   payslips**, and quick views (student/staff search, fee dues, TC register).
   Reuses the existing owner/tenant/permission-scoped APIs only — **no backend
   changes**.
5. **Homework/assignments** ✅ — section/subject assignments with attachments,
   student submissions (text + file), teacher review/grading, assign/submit
   notifications (migration `0020`); staff console + portal pages.
6. **AI advanced:** ✅ a dedicated **AI Insights** module (`/ai-insights`,
   `ai:*`, tenant-scoped + permission-guarded) — **report/KPI summaries** for 9
   modules (attendance, fees, exams, homework, payroll, library, transport,
   hostel, inventory), **attendance-risk alerts** (low-attendance students over a
   window), **fee pending/collection risk** (overdue + outstanding, manual
   reminder only — no auto-send), **embeddings document search** (semantic via
   OpenAI when configured, keyword fallback otherwise — metadata only, never file
   contents/keys), **deterministic workflow suggestions**, and an insights
   dashboard. All metrics are computed deterministically from tenant data and
   returned even when OpenAI is unconfigured; OpenAI only adds an optional
   natural-language narrative + semantic ranking. AI usage is logged best-effort
   to MongoDB. No new tables (migration `0031` adds the `ai:*` permissions only).

### Phase D — Operations modules + reporting 🟡
✅ **Reports Center** — 55 cross-module reports with filters + CSV/PDF export
(migration `0022`, `/report-center`, permission-gated; includes 6 college, 6
library, 7 transport, 6 hostel, 7 inventory, 7 staff-attendance/leave, 6 payroll
reports). ✅ **Library Management** —
catalogue, members, issue/return/renew with auto late-fines (→ Fees), settings, 6
reports (migration `0024`). ✅ **Transport Management** — vehicle & driver masters
(expiry tracking), routes + stops, student allocation, fee mapping with idempotent
**invoice generation** (→ Fees), trip-log foundation, 7 reports (migration `0025`).
✅ **Hostel Management** — hostels, blocks & rooms, student allocation with
capacity enforcement + **room transfer/vacate**, fee mapping with invoice
generation (→ Fees), 6 reports (migration `0026`). ✅ **Inventory Management** —
item categories, items, vendors; **purchases (stock-in)**, **issues (stock-out,
insufficient-stock guard)**, **adjustments** (damage/lost/correction); an
authoritative `current_stock` + **stock-movements audit ledger**; 7 reports
(migration `0027`, `/inventory`, `inventory:*`, tenant-scoped). ✅ **Staff
Attendance + Leave** — daily/bulk staff attendance (monthly summary), leave types
+ balances, leave request → approve/reject/cancel (approval deducts balance +
auto-marks attendance), a **payroll-attendance summary** foundation, and 7
reports (migration `0028`, `/staff` + `/leave`, `staff_attendance:*` / `leave:*`,
tenant-scoped + owner-scoped for staff). ✅ **Payroll Management** — salary
components (fixed/%), per-staff salary structures (with revision history), a
monthly **payroll run** that pulls the staff summary to prorate pay (auto
unpaid-leave deduction) computing gross/deductions/net, idempotent per
staff/month with **finalize/lock**, **owner-scoped payslip PDFs**, and 6 reports
(migration `0029`, `/payroll`, `payroll:*`, tenant-scoped). ✅ **Online Fee
Gateway** — pluggable, provider-agnostic hosted-checkout payments against existing
invoices: env-configured adapter (no hardcoded credentials, no card/bank/UPI data
stored), **payment orders** with anti-tampering (server-computed amount) and
duplicate-success prevention, a secure **signature-verified, idempotent webhook**
that credits the invoice + creates the existing fee-receipt payment on success,
fee-receipt PDF after payment, gateway **refund** initiation, per-institution
**feature-flag** enablement, 5 reports + reconciliation, and graceful degradation
(offline collection unaffected) when unconfigured (migration `0032`,
`/online-payments`, `online_payments:*`, tenant-scoped + owner-scoped for
student/parent). ✅ **Fee Management Depth** — fee **categories**, **term-wise
schedules** (class/section/program/semester/student-targeted) with idempotent
**invoice generation** + preview, **late fines** (fixed/per-day/percent + grace;
**waiver** permission-gated), **discounts/scholarships** (apply → approve, audited),
and 8 **dues/collection reports** (class/student/category dues, term collection,
fine collection, discounts, outstanding, defaulters). Built additively —
`amount_due` stays the net payable so offline payments + the online gateway are
unchanged (migration `0033`, `/fees/*`, `fee_categories|fee_schedules|fee_fines|
fee_discounts|fee_reports:*`, tenant + owner-scoped). ✅ **Transfer Certificates**
— TC register with atomic **sequence-based numbering**, draft→issued→cancelled
lifecycle, student/dues **snapshots**, a **dues check** (fees/library/transport/
hostel) that blocks issue unless an authorised user records a **dues override**,
**TC PDF** (cancelled = watermarked) re-downloadable, owner-scoped portal
download, student lifecycle (issuing flips the student to `transferred`, data
retained), and 4 reports (migration `0034`, `/transfer-certificates`,
`transfer_certificates:*`, tenant + owner-scoped). **Phase D operations are
complete.** Remaining (cross-phase): **custom report builder**.

### Phase E — Scale & polish ⬜
Caching, read replicas if needed, background job queue, observability/metrics,
accessibility audit, i18n, load testing.

---

## Part 2 — Testing plan (#9)

**Pyramid:** many fast unit tests → focused API integration tests → a thin layer
of E2E. Every PR must keep CI green.

| Layer | Tooling | Scope | Status |
|-------|---------|-------|--------|
| **Unit** | Vitest | utils (jwt, password, pagination) | ✅ 11 tests (`npm test`) |
| **API integration** | Supertest + real Postgres | auth/RBAC, owner-scoping, tenant isolation, sequence numbering, invoice `amount_paid` + overpay, per-module flows (incl. AI insights fallback, online-payment webhook idempotency + signature, fee schedule generation/fines/discounts, TC issue/dues-override/owner-scoped download, thread participant-scoping/read-state + permission guards), Swagger gating | ✅ 205 tests (`npm run test:integration`, in CI) |
| **Contract** | Validate responses against the generated OpenAPI spec | drift between code and Swagger | ⬜ |
| **Frontend** | React Testing Library (components), Playwright (E2E) | login → dashboard → create student → record payment | ⬜ |
| **Mobile** | `flutter analyze` + `flutter test` | parent/student (Phase 1) + **staff (Phase 2)**: attendance/marks/homework/communication/reports/payslips/timetable + quick views | 🟡 analyze in CI + smoke tests; widget/provider tests ⬜ |
| **Security** | dependency audit, `/security-review` on diffs, authz tests | RBAC, owner-scope, input validation, rate limits | 🟡 |
| **Performance** | k6/autocannon on hot endpoints | P95 < 300 ms at seed scale | ⬜ |

**Test data:** the `seed` script provides deterministic demo data; integration
tests run migrate + seed against an ephemeral Postgres (Compose service or CI
container). **Coverage targets:** services and middleware ≥ 80%; auth/fees
(money + access control) ≥ 95%.

**Definition of done per feature:** schema + service + route (+ `@openapi`),
unit tests for logic, an integration test for the endpoint(s), UI wired through
`lib/api.ts`, and green CI (backend typecheck+test+build, frontend build, flutter
analyze, Docker builds).

---

## Part 3 — Deployment plan — Hostinger VPS (#10)

Reference deployment: **Docker Compose + Nginx + SSL + GitHub Actions** on a
Hostinger VPS (works on any Docker host).

### Topology
Nginx (:80/:443, TLS) → `frontend` (:3000) + `backend` (:4000); `postgres` +
`mongo` internal-only with named volumes. Backend runs migrations on startup.

### One-time VPS setup
1. Provision the VPS (Ubuntu LTS). Point your domain's A record at its IP.
2. Install **Docker + Docker Compose**; create a deploy user; enable a firewall
   (allow 22/80/443 only).
3. Clone the repo to `/opt/sreedo`.
4. Create `.env` from `.env.example` with **strong secrets**
   (`openssl rand -hex 64` for `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`), a
   strong `POSTGRES_PASSWORD`, real `CORS_ORIGIN`, and `SEED_ON_START=true` for
   the **first boot only**.
5. `docker compose up -d --build`. Verify `https?://<host>/health`,
   `/api/docs`, and login. Then set `SEED_ON_START=false` and change the seeded
   admin password.

### TLS / SSL
- Easiest: run certbot on the host (`certbot --nginx`) to issue + auto-renew Let's
  Encrypt certs; or mount your own certs and add a `443` server block to
  `infra/nginx/default.conf` (HTTP→HTTPS redirect, HSTS).
- In production, **restrict `/api/docs`** (handover §8.5) — IP allowlist or basic
  auth at nginx.

### CI/CD (GitHub Actions)
- **CI today** (`.github/workflows/ci.yml`): backend typecheck + tests + build,
  frontend build, `flutter analyze`, Docker image builds — must be green to merge.
- **Add a deploy job** (Phase A) on push to `main`: build/push images to a
  registry (or build on host), then SSH to the VPS and
  `docker compose pull && docker compose up -d` (zero-downtime via health checks).
  Store `SSH_KEY`, host, and registry creds as GitHub **secrets**.

### Backups (do not skip — fee data is money)
- Nightly `pg_dump` to object storage **off the VPS** (cron + container).
- Test **restore** quarterly. Mongo (audit/AI) is non-critical but can be snapshotted.
- Phase A adds an admin-triggered backup endpoint/Ui on top of the cron baseline.

### Go-live checklist
- [ ] Strong secrets set; seeded admin password changed; `SEED_ON_START=false`.
- [ ] TLS valid + auto-renew; HTTP→HTTPS redirect; HSTS on.
- [ ] `/api/docs` restricted; `CORS_ORIGIN` locked to real domains.
- [ ] Nightly off-box `pg_dump` verified by a test restore.
- [ ] CI green; deploy job tested on a staging tag.
- [ ] `/health` monitored (uptime check); error logs shipped/retained.
- [ ] Owner-scoping live before any student/parent logins are issued.

Detailed click-by-click ops steps (for the non-technical owner) live in
`docs/ROADMAP.html` Phases 5–6.
