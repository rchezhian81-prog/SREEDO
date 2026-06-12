# Developer Handover — SRE EDU OS

Welcome. This document is the single starting point for taking over
development of SRE EDU OS, a school ERP. It explains what exists, how it is
put together, the conventions to follow, and the prioritized backlog of
known gaps. Read this top to bottom before writing code; it should take
about 20 minutes.

**Context:** the project owner is non-technical. The entire codebase to date
was generated and verified with Claude (Anthropic's AI coding agent) in
June 2026 from the technology stack specification, then pushed to this
repository. Everything described as "verified" below was actually executed
and tested against real databases, not just written.

---

## 1. What this project is

A school ERP covering: student & teacher records, classes/sections/subjects,
daily attendance, exams & results, fee invoicing & payments, announcements,
dashboards, and a GPT-4o assistant. Three clients, one API:

- `backend/` — Express 5 + TypeScript REST API (the core of the system)
- `frontend/` — Next.js 15 admin web app for school staff
- `mobile/` — Flutter app (read-only v0.1: dashboard, notices, profile)

Primary store is **PostgreSQL** (UUID PKs, plain SQL migrations, no ORM).
**MongoDB is optional** — it backs audit logs and AI chat history; every
feature degrades gracefully when it (or OpenAI, or SMTP) is unconfigured.

## 2. Current state — honest assessment

**Working and verified end-to-end:** login/refresh/logout with rotating
refresh tokens, role-based access, all CRUD modules, attendance bulk upsert,
invoice → payment flow with overpay rejection, Swagger (34 endpoints),
seeded demo data, Docker Compose stack, CI pipeline. 11 unit tests pass.

**Not verified:** the Flutter app was written without an SDK available, so
it has never been run — expect minor fixes on first `flutter analyze`/run.
Swagger UI rendering in a browser under helmet's CSP should be sanity-checked
once.

**Known gaps and issues** are listed in §8 — that's your backlog. Read it
before assuming something is missing by accident.

## 3. Run it locally (15 minutes)

```bash
cp .env.example .env        # set POSTGRES_PASSWORD + both JWT secrets
docker compose up --build
# Web: http://localhost   Swagger: http://localhost/api/docs
# Login: admin@sreedo.edu / Admin@12345  (seeded; change in any real env)
```

For iterative development, run pieces natively instead:

```bash
cd backend && cp .env.example .env && npm install
npm run migrate && npm run seed && npm run dev     # API :4000

cd frontend && cp .env.example .env.local && npm install
npm run dev                                        # web :3000
```

Backend commands: `npm run dev | build | start | typecheck | test | migrate | seed`.

Mobile: see `mobile/README.md` — you must run
`flutter create . --platforms android,ios --project-name sreedo_mobile`
once (platform folders are intentionally not committed), and
`flutterfire configure` only if you want push notifications.

## 4. Architecture and conventions

### Backend module pattern (the most important convention)

Every domain lives in `backend/src/modules/<name>/` with up to three files:

| File | Responsibility |
|------|----------------|
| `*.routes.ts` | Express router, authn/authz middleware, OpenAPI JSDoc annotations, parses input via the schema, delegates to the service |
| `*.schema.ts` | zod schemas for request bodies and query strings |
| `*.service.ts` | Business logic and SQL. Throws `ApiError` for expected failures |

**To add an endpoint:** schema → service function → route with `@openapi`
JSDoc → done. Swagger picks it up automatically (glob over `*.routes.*`).
Mount new routers in `src/app.ts`.

Supporting pieces:

- `src/middleware/auth.ts` — `authenticate` (JWT → `req.user`) and
  `authorize(...roles)`. Roles: `admin | teacher | accountant | student | parent`.
- `src/middleware/error.ts` — central error handler. Throw `ApiError` or let
  zod errors bubble; never hand-roll error responses in routes.
- `src/utils/params.ts` — use `uuidParam(req)` instead of `req.params.x`
  (Express 5 types params as `string | string[]`, and this validates UUIDs).
- `src/db/postgres.ts` — `query()` and `withTransaction()`. All SQL is
  parameterized ($1, $2…) — keep it that way, no string interpolation.
- Auth design: 15-min JWT access tokens; refresh tokens are opaque random
  strings stored **SHA-256-hashed** in `refresh_tokens`, rotated on every
  use, all sessions revoked on password change.

### Database migrations

Numbered SQL files in `backend/src/db/migrations/`, applied in order at
server startup (or via `npm run migrate`), tracked in `schema_migrations`.
**Rules:** never edit an already-applied migration — add a new numbered
file. The Dockerfile copies migrations into `dist/`, so they ship with the
image. Schema highlights: UUID PKs via `gen_random_uuid()`, `updated_at`
triggers, enum types for roles/attendance, CHECK constraints for statuses.

### Frontend

- `src/lib/api.ts` — the only place HTTP happens. Typed wrapper, attaches
  the bearer token, single-flight auto-refresh on 401, throws `ApiError`.
- `src/stores/auth-store.ts` — Zustand store persisted to localStorage.
- `src/components/ui.tsx` — shared primitives (Button, Modal, Field…).
  Use these rather than inventing new ones.
- Pages are client components under `src/app/(dashboard)/…` guarded by the
  layout (redirects to /login when unauthenticated). Forms use React Hook
  Form + zod resolvers — copy the students page as the reference pattern.

### Mobile

`ApiClient` (token persistence + refresh) → `ChangeNotifier` providers →
screens. GoRouter redirect drives auth. Same refresh-token flow as web.

## 5. Git & delivery workflow

1. Branch from `main` per task; open a PR back to `main`.
2. CI (`.github/workflows/ci.yml`) must be green: backend typecheck + tests
   + build, frontend build, `flutter analyze`, Docker builds.
3. **Never commit secrets.** `.env` is gitignored; only `.env.example`
   templates belong in the repo. If a secret ever lands in a commit, rotate
   it — do not just delete the file.
4. The owner reviews by *using the app*, not by reading diffs — deploy or
   demo each merged feature.

## 6. Configuration reference

All backend config is environment variables read in `src/config/env.ts`
(single source of truth — add new vars there). Key ones:

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `DATABASE_URL` | PostgreSQL connection | yes |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | token signing | yes (server refuses dev defaults in production) |
| `MONGO_URL` | audit log + AI history | no — features off when unset |
| `OPENAI_API_KEY` | AI assistant (returns 503 without it) | no |
| `SMTP_HOST/PORT/USER/PASS` | receipt emails (no-op without) | no |
| `SEED_ON_START` | demo data on first boot | no |
| `CORS_ORIGIN` | comma-separated allowed origins | prod: yes |

Frontend: `NEXT_PUBLIC_API_URL` (build-time, see `frontend/Dockerfile`).
Mobile: `--dart-define=API_URL=…`.

## 7. Deployment

Docker Compose on any host (designed for a Hostinger VPS): nginx (:80) →
frontend :3000 + backend :4000; postgres/mongo are internal-only with named
volumes. TLS via certbot on the host. Full steps with commands are in
`docs/ROADMAP.html` Phases 5–6. The single most urgent ops task after
go-live is a nightly `pg_dump` shipped off-box — fee data is money.

## 8. Backlog — known issues and missing pieces (prioritized)

Fix-before-production:

1. **Web app has no Exams page and no Users (account management) page** —
   the APIs are complete; only the UI screens are missing.
2. **Read endpoints are not owner-scoped.** Any authenticated user can list
   all students/invoices/attendance. Fine while only staff have logins;
   must be scoped before `student`/`parent` accounts are issued.
3. **Student delete is a hard delete** that cascades to attendance,
   invoices, payments. Convert to soft-delete (status change) and gate the
   hard delete.
4. **Tokens live in localStorage** (web). Acceptable for an internal staff
   tool; migrate to httpOnly cookies before exposing a public portal.
5. **Swagger UI is publicly reachable** — restrict at nginx in production.

Quality / robustness:

6. Admission/employee numbers use `count(*)+1` — racy under concurrency
   (fails clean on the unique constraint, but switch to a sequence).
7. Concurrent payments on one invoice can theoretically both pass the
   overpay check (snapshot vs. row lock) — store `amount_paid` on invoices.
8. Expired refresh tokens are never purged; no reuse detection.
9. Money handled as JS `number` in places — fine for whole rupees, review
   if paise precision matters.
10. No API integration tests — only unit tests on utils. Supertest against
    the seeded compose stack would be the highest-value testing addition.
11. Mobile FCM token is obtained but never registered with the backend;
    there is no push-sending endpoint yet.
12. `class_subjects` table exists but has no endpoints.

Feature roadmap (owner's priorities — confirm before starting): CSV student
import → timetables → parent/student portal → report-card PDFs → fee
reminders (SMTP + FCM) → file uploads (object storage) → embeddings search.

## 9. Suggested first week

- **Day 1:** run the stack, log in, click everything; read this doc and skim
  `backend/src/app.ts`, one full module (students), and `frontend/src/lib/api.ts`.
- **Day 2:** make CI yours — run typecheck/tests locally, run
  `flutter analyze`, fix anything it flags (expected: minor).
- **Day 3–5:** ship backlog items #1 (Exams + Users pages — pure pattern-
  copying from existing pages) and #3 (soft delete) as your first PRs.
  These are deliberately scoped to teach you the codebase end to end.

Questions the code can't answer (fee rules, academic calendar, who gets
which role) go to the owner — they hold the domain knowledge.
