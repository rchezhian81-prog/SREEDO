# Team Onboarding

> **Status:** Active · **Owner:** Engineering · **Last updated:** 2026-06-23
>
> Welcome to **GoCampus** (internally **SRE EDU OS**). This is the fastest path
> from zero to productive. Start at the [documentation index](./README.md) for the
> full map; this page is the guided tour.

---

## 1. What this project is

GoCampus is a **multi-tenant school & college ERP**. A single deployment serves
many institutions (tenants); each institution's data is isolated by an
`institution_id`. It covers the full operational surface of a school: admissions,
academics, attendance, exams & report cards, fees & online payments, timetable,
library, transport, hostel, inventory, payroll, leave, communication, a
parent/student portal, homework, documents, AI insights, reporting, transfer
certificates, discipline, backups, observability, and a platform/super-admin
console. It also has a **college mode** for higher-ed structures.

- **Public brand / domain:** GoCampus · `gocampusos.com`
- **Internal name / DB identity:** SRE EDU OS / `sreedo`
- **Product vision & scope:** [docs/PRD.md](./PRD.md)

## 2. Tech stack

| Layer | Stack |
|---|---|
| Web admin | Next.js 15 (App Router) · TypeScript · Tailwind CSS · Zustand · React Hook Form |
| Mobile | Flutter · Dart · GoRouter · Provider · Shared Preferences · FCM (optional) |
| Backend | Node.js · Express 5 · TypeScript · JWT auth · Swagger/OpenAPI · rate limiting |
| Primary DB | **PostgreSQL 16** (system of record, UUID PKs) |
| Secondary DB | **MongoDB 7** (optional: audit logs + AI chat history) |
| AI (optional) | OpenAI GPT-4o assistant grounded in live school data |
| Infra | Docker Compose · Nginx (TLS) · GitHub Actions CI |

> **There is no Redis** and no external message broker. Background jobs run on a
> Postgres-backed queue inside the backend process. Optional integrations
> (MongoDB, OpenAI, SMTP, SMS, FCM, S3 storage, payment gateway) **degrade
> gracefully** when their env vars are unset.

Deeper reference: [docs/ARCHITECTURE.md](./ARCHITECTURE.md).

## 3. Repository structure

```
backend/    Express API. Modules live in src/modules/<name>/ as
            routes.ts (+ @openapi) · schema.ts (zod) · service.ts (parameterized SQL).
            DB access via src/db/postgres.ts; migrations in src/db/migrations/.
frontend/   Next.js admin app. Pages in src/app/, UI primitives in
            src/components/ui.tsx, state in src/stores/, HTTP via src/lib/api.ts.
mobile/     Flutter app (parent/student portal + staff experience).
infra/      Nginx configs (dev default.conf, prod TLS).
docs/       All documentation (you are here).
.github/    CI workflow.
docker-compose.yml            Base stack (postgres, mongo, backend, frontend, nginx).
docker-compose.prod.yml*      Production override used on the live VPS (TLS/certbot).
```
\* The prod override + certbot setup exist on the production server; see
[deployment](./DEPLOYMENT.md) and the
[production go-live diagram](./diagrams/diagram_production-go-live-flow.md).

Conventions you must follow are in [`CLAUDE.md`](../CLAUDE.md) (hard rules) and the
[developer handover](./DEVELOPER_HANDOVER.md).

## 4. Run it locally

**Full stack (Docker — easiest):**
```bash
cp .env.example .env          # set POSTGRES_PASSWORD + JWT secrets
docker compose up --build     # web on http://localhost, Swagger at /api/docs
```
Seeded admin on first boot: `admin@sreedo.edu` / `Admin@12345` (change in prod).

**Backend only:**
```bash
cd backend && cp .env.example .env   # point DATABASE_URL at your Postgres
npm install && npm run migrate && npm run seed
npm run dev                          # http://localhost:4000
```

**Frontend only:**
```bash
cd frontend && cp .env.example .env.local
npm install && npm run dev           # http://localhost:3000
```

**Mobile:** see [`mobile/README.md`](../mobile/README.md) — `flutter pub get`
then `flutter run` (override the API base with `--dart-define=API_URL=...`).

## 5. How to read the module docs

Every feature area has a doc in [`docs/modules/`](./modules/) named
`<module-name>-module.md`. Each one has the **same 11 sections**: purpose, roles,
screens, APIs, DB tables, RBAC, tenant isolation, workflows, test coverage,
troubleshooting, and future enhancements. To understand a feature:
1. Open its module doc for the map (APIs + tables + permissions).
2. Open the matching backend module `backend/src/modules/<name>/` (routes → service).
3. Open the matching pipeline diagram in [`docs/diagrams/`](./diagrams/).
4. Cross-check details in [API_REFERENCE.md](./API_REFERENCE.md),
   [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), and [MODULE_WORKFLOWS.md](./MODULE_WORKFLOWS.md).

## 6. Understand RBAC & tenant isolation (read this before writing endpoints)

**Roles:** `super_admin` (platform-wide, cross-tenant), `admin`, `teacher`,
`accountant`, `student`, `parent`.

**RBAC:** Authorization uses granular `module:action` permission **keys** (e.g.
`fees:manage`, `attendance:mark`) stored in the `permissions` and
`role_permissions` tables and enforced by the `requirePermission('key')`
middleware (results cached briefly). `super_admin` bypasses checks. Grant/revoke
happens via the platform console and invalidates the cache.

**Tenant isolation:** Every domain table carries an `institution_id`. Request
handling calls `requireTenant(req)` / `tenantId(req)`; **every tenant-scoped query
must filter by `institution_id`**. Platform/super-admin routes are guarded by
`authorize('super_admin')` and are intentionally not tenant-scoped.

Full detail:
[super-admin / multi-tenancy / RBAC module doc](./modules/super-admin-multi-tenancy-rbac-module.md),
[auth-rbac-tenant diagram](./diagrams/diagram_auth-rbac-tenant-flow.md),
[ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md).

## 7. Run the tests

```bash
# Backend
cd backend
npm run typecheck
npm test                       # unit tests (Vitest)
npm run test:integration       # Supertest API tests — needs a disposable Postgres (DATABASE_URL)

# Frontend
cd frontend
npm run typecheck && npm run build
npm run e2e:smoke              # Playwright smoke (or e2e:validate to compile only)

# Mobile
cd mobile && flutter analyze
```
CI runs all of these on every PR. Details: [E2E_TESTING.md](./E2E_TESTING.md),
[PERFORMANCE.md](./PERFORMANCE.md).

## 8. Deploy

Production runs via Docker Compose on a VPS behind nginx + Let's Encrypt TLS,
serving `gocampusos.com`. The authoritative runbook is
[docs/DEPLOYMENT.md](./DEPLOYMENT.md); the visual flow is
[diagram_production-go-live-flow.md](./diagrams/diagram_production-go-live-flow.md).
Key facts: migrations auto-run on backend boot; data lives in the `pgdata` /
`mongodata` Docker volumes (preserved across `docker compose up -d --build`);
**never** run `docker compose down -v` in production (it deletes volumes).

## 9. Troubleshoot

- Each module doc has a **Common troubleshooting** table — start there.
- Health probes: `GET /health` (and `/ready`, `/live`) report DB connectivity.
- Logs: `docker compose logs -f backend` (structured JSON; every line has an
  `x-request-id`).
- Observability: [observability module](./modules/observability-module.md).
- Backups & restore drills: [backup-restore module](./modules/backup-restore-module.md).

## 10. Where the "latest" files are listed

The single index of current documents is the
**[Latest Document Register](./governance/LATEST_DOCUMENT_REGISTER.md)**. If you're
ever unsure which doc is canonical for an area, look there first.

## 11. How to document future upgrades

Follow the governance suite:
- Name files per the [File Naming Standard](./governance/FILE_NAMING_STANDARD.md).
- Branch → PR → green CI → review → merge, per
  [Release & Change Management](./governance/RELEASE_AND_CHANGE_MANAGEMENT.md).
- Tick the [Update Documentation Checklist](./templates/update-documentation-checklist.md)
  in every PR (update module docs, diagrams, the register, and release/rollback notes).
- Regenerate the team handoff package with `scripts/create-handoff-zip.sh`
  (see [handoff manifest](./governance/HANDOFF_ZIP_MANIFEST.md)).

Welcome aboard. 🎓
