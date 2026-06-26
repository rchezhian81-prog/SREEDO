# CLAUDE.md — project conventions for AI-assisted development

SRE EDU OS school ERP monorepo: `backend/` (Express 5 + TS + PostgreSQL),
`frontend/` (Next.js 15 + Tailwind + Zustand), `mobile/` (Flutter),
`infra/` (nginx), Docker Compose at root.

Full orientation: `docs/DEVELOPER_HANDOVER.md`. Backlog lives there too (§8).
Planning suite (PRD, architecture, schema, API, roles, workflows, UI, roadmap)
is indexed in `docs/PLANNING_INDEX.md`.

## Commands

- Backend (`cd backend`): `npm run dev | typecheck | test | build | migrate | seed`
  (`npm test` = unit only; `npm run test:integration` needs `DATABASE_URL` to a
  disposable Postgres — runs Supertest API tests, migrating automatically)
- Frontend (`cd frontend`): `npm run dev | build | typecheck`
- Mobile (`cd mobile`): `flutter pub get && flutter analyze`
- Full stack: `docker compose up --build` (web on :80, seeded admin
  `admin@sreedo.edu` / `Admin@12345`)
- Local API smoke test: `GET /health`, Swagger at `/api/docs`

## Hard rules

- Backend modules follow routes/schema/service in `src/modules/<name>/`;
  zod-validate every input; throw `ApiError` — the error middleware formats
  responses. SQL is always parameterized via `query()`/`withTransaction()`
  from `src/db/postgres.ts`.
- Use `uuidParam(req)`/`param(req, name)` from `src/utils/params.ts`, never
  raw `req.params.x` (Express 5 types + validation).
- Never edit an applied migration — add a new numbered file in
  `src/db/migrations/`.
- Every new endpoint gets an `@openapi` JSDoc block (Swagger is generated
  from route files).
- New env vars go through `src/config/env.ts` and both `.env.example` files.
- MongoDB/OpenAI/SMTP are optional dependencies — new features touching
  them must degrade gracefully when unconfigured.
- Frontend HTTP goes through `src/lib/api.ts` only; reuse
  `src/components/ui.tsx` primitives; copy the students page as the form/
  table reference pattern.
- Before pushing: backend `typecheck` + `test`, frontend `build` must pass.
- Never commit secrets; only `.env.example` templates.

## Project state & deploy (updated 2026-06-26)

- **Production**: live on a VPS at `/opt/sreedo` via
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
  The VPS's `docker-compose.prod.yml` and `infra/` SSL files (certbot,
  `nginx/prod.conf`, `enable-https.sh`, `init-letsencrypt.sh`, `secure-admins.sh`)
  are **server-local — keep the VPS copy, do not overwrite with the repo's**.
  Update procedure on the VPS: back up `docker-compose.prod.yml`, `git pull
  --ff-only origin main`, restore it, then `up -d --build`. The backend runs
  `runMigrations()` on boot (`src/server.ts`), so migrations apply automatically
  on deploy. `deploy.yml` (GH Actions) auto-deploys only when
  `vars.DEPLOY_ENABLED == 'true'` + `VPS_*` secrets are set (currently off →
  manual deploy is used).
- **School vs College is structural, not cosmetic.** Pre-login `/select` sets a
  `mode` store (`sreedo-mode`). Institution `type` (DB) is the source of truth:
  the dashboard reconciles `mode` from `GET /auth/me` (`institutionType`). The
  guard `requireInstitutionType()` (`src/middleware/institution-type.ts`, cached,
  super_admin bypass) makes college routes college-only and class/section
  creation school-only; `/college/overview` + `/college/settings` stay open so a
  school can switch in (cache busted on switch).
- **Terminology engine** `frontend/src/lib/terms.ts` + `useTerms()` — one source
  of truth for School↔College nouns (Teacher/Faculty, Class/Program,
  Section/Batch, Subject/Course, Term/Semester, Admission No/Registration No).
  Adopt on a page by swapping a literal for the term. The dashboard sidebar
  splits its nav by mode.
- **Icons**: `lucide-react` behind the `<Icon name="…">` facade in
  `frontend/src/components/icons.tsx` — don't hand-draw SVGs; add a Lucide
  mapping.
- **Students**: one shared write-column list in `students.service` drives
  create/import/update; Add+Edit via `PATCH /students/:id`. College students are
  placed via enrollments (program/semester), not sections. Bulk promotion /
  year-rollover: `POST /students/promote`. Inline guardian has a relationship +
  Profile-v2 demographic fields.
- **Live Classes**: module at `/live-classes` (scheduled sessions + provider
  join links; admin/teacher).
- Feature-complete vs Fedena. Open follow-ups: deeper frontend test flows,
  Live-Classes provider API, terminology long-tail, and a few new modules
  (student leave, co-curricular, PTM, syllabus, substitute teacher, question
  bank).
