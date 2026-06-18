# System Architecture — SRE EDU OS

Covers requested deliverables **#1 System architecture** and **#6 Folder
structure**. Read alongside [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md),
[`API_REFERENCE.md`](./API_REFERENCE.md), and [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md).

## 1. Context (one API, many clients)

```
        ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
        │  Next.js web │      │  Flutter app │      │ Parent / Student │
        │  (staff)     │      │  (staff/...) │      │ portals (future) │
        └──────┬───────┘      └──────┬───────┘      └────────┬─────────┘
               │   HTTPS               │                       │
               └──────────────┬───────┴───────────────────────┘
                              ▼
                    ┌────────────────────┐
                    │   Nginx (TLS, :80) │  reverse proxy + static
                    └─────────┬──────────┘
                              ▼
                ┌──────────────────────────────┐
                │  Express.js API (TypeScript)  │  stateless, horizontally scalable
                │  JWT · RBAC · zod · rate-limit│
                │  Swagger · audit · error mw   │
                └───┬───────────┬──────────┬────┘
                    ▼           ▼          ▼
            ┌────────────┐ ┌─────────┐ ┌──────────────┐ ┌──────────────┐
            │ PostgreSQL │ │ MongoDB │ │ OpenAI GPT-4o│ │ SMTP / SMS / │
            │ (records)  │ │ (audit, │ │ + embeddings │ │ object store │
            │ UUID PKs   │ │  AI log)│ │ (optional)   │ │ (optional)   │
            └────────────┘ └─────────┘ └──────────────┘ └──────────────┘
```

**Principles**

- **API-first** — the Express API is the single backend; web and mobile consume
  the identical REST contract documented in Swagger (`/api/docs`).
- **PostgreSQL is the system of record** (UUID PKs, plain SQL migrations, no ORM).
- **MongoDB / OpenAI / SMTP / object storage / SMS are optional** — each feature
  degrades gracefully when its dependency is unconfigured.
- **Stateless API** — no server session state; auth is bearer-token, so any
  instance can serve any request → scale by adding instances behind nginx.

## 2. Backend internal architecture (clean, modular)

Request lifecycle:

```
HTTP → nginx → express.json → CORS → helmet → morgan
     → /api/v1 router → rate-limit → audit-log
     → module router → authenticate → authorize(roles)
     → zod schema parse → service (SQL via query/withTransaction)
     → response  | errors → central errorHandler → consistent JSON envelope
```

**Module pattern** (the most important convention — one folder per domain):

| File | Responsibility |
|------|----------------|
| `*.routes.ts` | Express router; `authenticate`/`authorize`; `@openapi` JSDoc; parses input via schema; delegates to service |
| `*.schema.ts` | zod schemas for bodies & query strings |
| `*.service.ts` | Business logic + parameterized SQL; throws `ApiError` for expected failures |

**Cross-cutting middleware/utilities**

- `middleware/auth.ts` — `authenticate` (JWT → `req.user`), `authorize(...roles)`.
- `middleware/error.ts` — central handler; throw `ApiError` or let zod errors bubble.
- `middleware/rate-limit.ts` — global API + stricter auth limiter.
- `middleware/audit.ts` — logs mutations to Mongo when connected.
- `db/postgres.ts` — `query()` / `withTransaction()`; **all SQL parameterized**.
- `db/mongo.ts` — optional Mongo client; `getMongoDb()` returns `null` when off.
- `utils/` — `jwt`, `password` (bcrypt), `api-error`, `pagination`, `params`
  (`uuidParam`/`param` — never raw `req.params`), `mailer`.
- `config/env.ts` — **single source of truth** for env vars.
- `config/swagger.ts` — generates the OpenAPI spec from route JSDoc.

**To add an endpoint:** schema → service fn → route with `@openapi` → mount
router in `app.ts`. Swagger picks it up automatically.

## 3. Authentication & session design

- **Access token:** JWT, 15-minute TTL, carries `userId` + `role`.
- **Refresh token:** opaque random string, stored **SHA-256-hashed** in
  `refresh_tokens`, **rotated on every use**, revoked by row deletion.
- **Password change** revokes all of a user's refresh tokens.
- **Web** stores tokens in localStorage today (migrate to httpOnly cookies before
  exposing public portals — handover §8). **Mobile** persists via Shared
  Preferences with the same refresh flow.

## 4. Authorization model

- **Today:** role gate via `authorize(...roles)` over 5 roles
  (`admin`, `teacher`, `accountant`, `student`, `parent`).
- **Target:** role + **granular permission** layer (`module:action`) plus
  **owner-scoping** of reads (a parent/student sees only their own records).
  See [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md).

## 5. Multi-tenancy (target)

Single-database, shared-schema, row-scoped by `institution_id` (and optional
`branch_id`):

- Add `institution_id` FK to tenant-scoped tables; index it.
- Resolve tenant from the authenticated user (or super-admin context switch).
- A `tenant` middleware injects `req.tenantId`; services filter every query by it.
- Super Admin operates **above** tenants (institution/branch/package CRUD).

This is the largest planned cross-cutting change (Phase A) — designed now so new
modules adopt it from the start.

## 6. AI architecture

- **Assistant:** `ai.service.ts` builds a system prompt from live KPIs (Postgres
  counts/sums) + recent conversation (Mongo), calls GPT-4o, persists the turn.
- **Embeddings (planned):** index documents/notices/student notes via OpenAI
  embeddings into a vector store (pgvector in Postgres, or Mongo Atlas Vector);
  semantic search endpoint returns ranked records.
- **Risk alerts (planned):** scheduled job scans attendance/fees/marks and writes
  alerts to the dashboard + notifications.
- All AI paths are **feature-flagged on `OPENAI_API_KEY`**; absent → HTTP 503 on
  AI routes, everything else unaffected.

## 7. Frontend architecture (web)

- **Next.js 15 App Router**, client components under `src/app/(dashboard)/…`
  guarded by the dashboard layout (redirect to `/login` when unauthenticated).
- **`src/lib/api.ts`** — the only place HTTP happens: typed wrapper, attaches
  bearer token, single-flight auto-refresh on 401, throws `ApiError`.
- **`src/stores/auth-store.ts`** — Zustand, persisted to localStorage.
- **`src/components/ui.tsx`** — shared soft-3D primitives (Button, Modal, Field…);
  reuse rather than reinventing. Forms use React Hook Form + zod resolvers; the
  **students page is the reference pattern** for table+form screens.

## 8. Mobile architecture

`ApiClient` (token persistence + refresh) → `ChangeNotifier`/Provider state →
GoRouter (redirect drives auth) → screens. FCM via `notification_service.dart`.
Same refresh-token contract as web.

## 9. Deployment topology

Docker Compose: `nginx` (:80/443) → `frontend` (:3000) + `backend` (:4000);
`postgres` and `mongo` are internal-only with named volumes. Migrations run at
backend startup (shipped inside the image). TLS via certbot on the host. Full
steps in [`DEV_ROADMAP.md`](./DEV_ROADMAP.md) and `docs/ROADMAP.html`.

## 10. Folder structure (deliverable #6)

```
SREEDO/
├── backend/                      Express 5 + TypeScript API (system core)
│   ├── src/
│   │   ├── app.ts                Express app: middleware + router mounting
│   │   ├── server.ts             HTTP bootstrap (migrate-on-start, listen)
│   │   ├── config/
│   │   │   ├── env.ts            Single source of truth for env vars
│   │   │   └── swagger.ts        OpenAPI spec generation from JSDoc
│   │   ├── db/
│   │   │   ├── postgres.ts       Pool, query(), withTransaction()
│   │   │   ├── mongo.ts          Optional Mongo client
│   │   │   ├── migrate.ts        Numbered-migration runner
│   │   │   ├── seed.ts           Demo data + admin seed
│   │   │   └── migrations/       0001_auth … 0006_announcements (.sql)
│   │   ├── middleware/           auth, error, rate-limit, audit
│   │   ├── modules/              one folder per domain (routes/schema/service)
│   │   │   ├── auth/  users/  students/  teachers/  academics/
│   │   │   ├── attendance/  exams/  fees/  announcements/
│   │   │   └── dashboard/  ai/
│   │   ├── utils/                jwt, password, api-error, pagination, params, mailer
│   │   └── types/                shared TS types
│   ├── Dockerfile · package.json · tsconfig.json · .env.example
│
├── frontend/                     Next.js 15 admin web app
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx · page.tsx · globals.css
│   │   │   ├── login/page.tsx
│   │   │   └── (dashboard)/      layout + dashboard, students, teachers,
│   │   │                         classes, attendance, fees, announcements, assistant
│   │   ├── components/ui.tsx     shared soft-3D primitives
│   │   ├── lib/api.ts            typed HTTP client (only HTTP entry point)
│   │   ├── stores/auth-store.ts  Zustand auth state
│   │   └── types/index.ts
│   ├── Dockerfile · next.config.mjs · tailwind.config.ts · tsconfig.json
│
├── mobile/                       Flutter app (read-only v0.1)
│   └── lib/  (app, main, core/api_client, providers/, screens/, services/)
│
├── infra/nginx/default.conf      reverse-proxy config
├── .github/workflows/ci.yml      CI: backend typecheck+test+build, FE build, flutter analyze
├── docs/                         PRD, architecture, schema, API, roles, workflows, UI, roadmap, handover
├── docker-compose.yml            full stack
└── CLAUDE.md · README.md · .env.example
```

**Conventions that keep this structure healthy** (enforced via CLAUDE.md):
new domain → new `modules/<name>/` folder; new env var → `config/env.ts` + both
`.env.example`; new endpoint → `@openapi` JSDoc; new schema change → new numbered
migration (never edit an applied one); frontend HTTP → `lib/api.ts` only.
