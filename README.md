# SRE EDU OS — School ERP

A full-stack school ERP: student & teacher management, classes and sections,
daily attendance, exams & results, fee invoicing & payments, announcements,
and an AI assistant grounded in live school data.

## Architecture

```
┌─────────────┐   ┌──────────────┐
│  Next.js    │   │  Flutter     │
│  web admin  │   │  mobile app  │
└──────┬──────┘   └──────┬───────┘
       │   HTTPS (nginx) │
       ▼                 ▼
┌─────────────────────────────────┐
│  Express.js API (TypeScript)    │
│  JWT auth · Swagger · rate limit│
└──────┬──────────────┬───────────┘
       ▼              ▼
┌────────────┐  ┌───────────┐   ┌───────────┐
│ PostgreSQL │  │  MongoDB  │   │ OpenAI    │
│ (UUID PKs) │  │ audit/AI  │   │ GPT-4o    │
└────────────┘  └───────────┘   └───────────┘
```

| Layer    | Stack |
|----------|-------|
| Frontend | Next.js · TypeScript · Tailwind CSS · Zustand · React Hook Form |
| Mobile   | Flutter · Dart · GoRouter · Provider · Shared Preferences · Firebase Cloud Messaging |
| Backend  | Node.js · Express.js · TypeScript · JWT auth · Swagger · rate limiting |
| Database | PostgreSQL (system of record, UUID PKs) · MongoDB (audit logs, AI conversations) |
| AI       | OpenAI GPT-4o assistant with live school statistics |
| Infra    | Docker · Nginx · GitHub Actions · SMTP email · Hostinger VPS-ready |

## Repository layout

```
backend/    Express API — modules: auth, users, students, teachers,
            academics, attendance, exams, fees, announcements, dashboard, ai
frontend/   Next.js admin app (login, dashboard, students, teachers,
            classes, attendance, fees, announcements, AI assistant)
mobile/     Flutter app (dashboard, notice board, profile, FCM)
infra/      Nginx reverse-proxy config
.github/    CI: backend typecheck+tests+build, frontend build, flutter analyze
```

## Documentation

📖 **[`docs/README.md`](docs/README.md) is the documentation hub — start there.**
New team members should begin with **[Team Onboarding](docs/TEAM_ONBOARDING.md)**.

Key entry points:

- [Documentation index](docs/README.md) — links to every document.
- [Team onboarding](docs/TEAM_ONBOARDING.md) — zero-to-productive guide.
- [Deployment guide](docs/DEPLOYMENT.md) — VPS + Docker + TLS go-live runbook.
- [Latest document register](docs/governance/LATEST_DOCUMENT_REGISTER.md) — the
  canonical document for every area.
- [File naming standard](docs/governance/FILE_NAMING_STANDARD.md) — how docs are
  named, versioned, and kept duplicate-free.
- [Module docs](docs/modules/) · [pipeline diagrams](docs/diagrams/) — per-module
  references and Mermaid flows.
- [Planning suite](docs/PLANNING_INDEX.md) · [developer handover](docs/DEVELOPER_HANDOVER.md)
  — original specs (PRD, architecture, schema, API, roles, workflows, UI,
  roadmap), conventions, and the prioritized backlog.

## Quick start (Docker)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and JWT secrets
docker compose up --build
```

Then open:

- Web app: http://localhost
- Swagger UI: http://localhost/api/docs
- Health: http://localhost/health

With `SEED_ON_START=true` (default in `.env.example`) the first boot creates
demo data and an admin account: **admin@sreedo.edu / Admin@12345** — change
it immediately in production.

## Local development

### Backend

```bash
cd backend
cp .env.example .env          # point DATABASE_URL at your PostgreSQL
npm install
npm run migrate && npm run seed
npm run dev                   # http://localhost:4000, Swagger at /api/docs
```

MongoDB (`MONGO_URL`), OpenAI (`OPENAI_API_KEY`) and SMTP (`SMTP_*`) are
optional — the related features (audit log, AI assistant, receipt emails)
switch off gracefully when unset.

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

### Mobile

See [mobile/README.md](mobile/README.md) — generate platform folders with
`flutter create .`, then `flutter run`. Push notifications activate after
`flutterfire configure`.

## API overview

All endpoints live under `/api/v1` and are documented in Swagger
(`/api/docs`). Authentication is JWT bearer: short-lived access tokens plus
rotating, server-side-revocable refresh tokens. Roles: `admin`, `teacher`,
`accountant`, `student`, `parent`.

| Area | Endpoints |
|------|-----------|
| Auth | login, refresh, logout, me, change-password |
| Users | admin CRUD over accounts |
| Students | CRUD, search, pagination, auto admission numbers |
| Teachers | CRUD, auto employee numbers |
| Academics | academic years, classes, sections, subjects |
| Attendance | bulk upsert per date, per-section view, student history |
| Exams | exams, bulk result upsert, student report |
| Fees | structures, invoices, payments (with overpay guard), summary |
| Announcements | CRUD with audience targeting and pinning |
| AI | GPT-4o assistant with conversation history in MongoDB |

Login attempts are rate-limited separately from the global API limiter.
Mutating requests are audit-logged to MongoDB when it is connected.

## Deployment (Hostinger VPS or any Docker host)

1. Install Docker + Docker Compose on the VPS.
2. Clone the repo, create `.env` with strong secrets
   (`openssl rand -hex 64` for the JWT secrets) and `SEED_ON_START=false`
   after the first boot.
3. `docker compose up -d --build` — nginx serves everything on port 80.
4. TLS: point your domain at the VPS, then issue certificates with
   certbot (`certbot --nginx`) or mount your own certs and add a 443
   server block to `infra/nginx/default.conf`.
5. CI (GitHub Actions) runs typechecks, tests and builds on every push;
   extend `.github/workflows/ci.yml` with a deploy job (e.g. SSH +
   `docker compose pull/up`) when ready.

## Roadmap

- Timetables and teacher workload planning
- Parent/student self-service portals (role-scoped read endpoints exist)
- Object storage for documents and student photos
- OpenAI embeddings for semantic search over school records
- Fee reminders via SMTP + FCM push campaigns
