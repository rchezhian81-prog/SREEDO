# E2E & Contract Testing

Two complementary layers sit above the unit/integration tests:

- **API contract tests** (backend, **run in CI**) — assert the generated OpenAPI
  document is well-formed and covers the important API groups, that the live API
  returns documented status codes, and that the security guarantees hold
  (authn/authz, tenant isolation, owner-scoping, portal cookie auth).
- **Playwright E2E tests** (frontend, **run manually** against a live stack) — real
  browser flows for the key user journeys. CI only *validates* the suite (compile +
  discover) to keep it honest without slowing CI or needing browsers.

## Contract tests (CI-run)

They live in `backend/tests/integration/contract.int.test.ts` and run as part of the
normal integration suite — no extra services beyond the test Postgres.

```bash
cd backend
DATABASE_URL=postgres://USER:PASS@localhost:5432/sreedo_test npm run test:integration
# or just the contract file:
DATABASE_URL=… npx vitest run --config vitest.integration.config.ts tests/integration/contract.int.test.ts
```

What they cover: OpenAPI 3.x validity + metadata + bearer scheme; presence of every
important API group (auth, students, teachers, attendance, fees, reports, documents,
homework, communication, portal, platform/RBAC); documented-status conformance for
representative endpoints; and security contracts — **401** unauthenticated, **403**
role/permission denial, **404** cross-tenant reads, **403** cross-student (owner
scope), and the portal cookie-auth flow.

## Playwright E2E (manual)

The suite is in `frontend/e2e/`. It assumes a **freshly seeded** backend (demo seed:
`admin@sreedo.edu` / `Admin@12345`, plus `super@`, `student@`, `parent@`).

### Run locally

```bash
# 1. Backend against a disposable DB, seeded, with relaxed rate limits.
cd backend
DATABASE_URL=postgres://USER:PASS@localhost:5432/sreedo_e2e npm run migrate
DATABASE_URL=postgres://USER:PASS@localhost:5432/sreedo_e2e npm run seed
DATABASE_URL=postgres://USER:PASS@localhost:5432/sreedo_e2e \
JWT_ACCESS_SECRET=e2e-not-dev JWT_REFRESH_SECRET=e2e-not-dev \
PORT=4000 RATE_LIMIT_MAX=1000000 AUTH_RATE_LIMIT_MAX=1000000 npm run dev

# 2. Install browsers once (needs network egress to Playwright's CDN).
cd ../frontend
npx playwright install chromium

# 3. Run the suite (Playwright starts the frontend dev server itself and points it
#    at the backend via NEXT_PUBLIC_API_URL).
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1 npm run e2e          # full suite
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1 npm run e2e:smoke    # @smoke subset only
```

Useful env: `E2E_BASE_URL` (default `http://localhost:3000`), `NEXT_PUBLIC_API_URL`
(default `http://localhost:4000/api/v1`), `E2E_NO_WEBSERVER=1` (don't auto-start the
frontend — use one you started yourself / a staging URL).

### Run against staging

```bash
E2E_BASE_URL=https://staging.example.com E2E_NO_WEBSERVER=1 \
npx playwright test --grep @smoke
```
Use staging demo accounts; the suite creates data (students, etc.), so point it at a
non-production environment.

### Validate without browsers (what CI runs)

```bash
cd frontend
npm run e2e:validate   # playwright test --list — compiles + discovers, no browsers
```
This runs in the frontend CI job so the specs can't silently rot. **Browsers are not
installed in CI and the full E2E run is not part of CI** (it needs the whole stack and
would slow every build).

> Note: in the build sandbox, the Playwright browser download is blocked by network
> egress policy, so the browser run is performed locally/in staging, not in CI. The
> specs are kept honest in CI by `e2e:validate` + `typecheck`, and the executable
> safety net for behaviour is the contract suite.

## Flows covered (Playwright)

**Smoke** (`smoke.spec.ts`, `@smoke`): admin sign-in + dashboard, create student,
language switcher (English ↔ Tamil), student portal sign-in.

**Security** (`security.spec.ts`): unauthenticated → login redirect (dashboard &
portal), portal account can't reach the staff dashboard. (Data-level isolation —
cross-student, cross-tenant, cross-child — is asserted by the **contract tests**.)

**Critical happy path** (`critical-flow.spec.ts`): admin enrols a student → fees /
payment where supported → Reports Center → a portal user sees related data.

**Extended** (`extended.spec.ts`): create staff/teacher, mark attendance, create
homework, communication inbox, document upload/download, parent views linked child,
student views homework — each guarded to the parts the UI supports.

## Accessibility & i18n in E2E

The smoke suite exercises the **language switcher** end-to-end, and the shared
accessible primitives (labelled fields, dialog roles) are what make the role/label
selectors above stable. Component-level a11y is unit-tested in
`frontend/src/components/ui.a11y.test.tsx`.
