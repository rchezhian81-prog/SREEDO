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
