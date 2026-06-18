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
   off in production — all done. Remaining: httpOnly-cookie token storage
   (deferred to the public-portal phase).
2. **Permissions layer:** `permissions` + `role_permissions`,
   `requirePermission()`, seed the role matrix.
3. **Multi-tenancy:** 🟡 `institutions`/`branches`/`subscription_packages`/
   `institution_subscriptions` tables + `super_admin` role shipped (migration
   `0011`). Remaining: add `institution_id` to tenant-scoped tables (add →
   backfill → NOT NULL → index → scope queries) + `tenant` middleware.
4. **Super Admin panel:** 🟡 backend CRUD for institutions, branches,
   packages and subscriptions shipped. Remaining: web UI, global settings,
   backups, global audit-log viewer.
5. ✅ **MVP UI gaps filled:** Exams & Results page and Users/account-management
   page shipped.

### Phase B — Academic depth (college mode + timetables) ⬜
1. **College mode:** departments, courses/programs, semesters; make
   term/semester configurable per institution `type`.
2. **Timetable:** rooms, periods, slots, **conflict checking**; teacher
   timetable view.
3. **Grading:** grade bands + report-card computation (sets up PDF in Phase C).

### Phase C — Engagement (portals, homework, comms, AI+) ⬜
1. **Object storage** adapter + secure uploads (documents, photos, attachments).
2. **PDFs:** fee **receipts**, **report cards**, ID cards, transfer certificates.
3. **Communication:** generalize SMTP email, add **SMS** + **FCM push** adapters,
   internal messaging, notifications + device-token registration.
4. **Parent & Student portals** (web + mobile) on owner-scoped endpoints.
5. **Homework/assignments** with submissions.
6. **AI advanced:** embeddings document search, attendance-risk alerts, fee/
   performance summaries.

### Phase D — Operations modules + reporting ⬜
Library · Transport · Hostel · Inventory · Payroll (each with fee/finance
integration where relevant) · **Report Center** (cross-module export/print) ·
**custom report builder**.

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
| **API integration** | Supertest + real Postgres | auth/RBAC, owner-scoping, sequence numbering, invoice `amount_paid` + overpay, Swagger gating | ✅ 18 tests (`npm run test:integration`, in CI) |
| **Contract** | Validate responses against the generated OpenAPI spec | drift between code and Swagger | ⬜ |
| **Frontend** | React Testing Library (components), Playwright (E2E) | login → dashboard → create student → record payment | ⬜ |
| **Mobile** | `flutter analyze` + `flutter test` | widget/provider tests | 🟡 analyze in CI; tests ⬜ |
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
