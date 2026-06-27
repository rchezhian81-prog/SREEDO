# Security Posture & Hardening — SRE EDU OS (GoCampusOS)

This document describes the security controls that exist in the codebase today,
the hardening added in the SaaS-readiness pass, and the residual gaps with a
prioritised plan to close them. It is grounded in the actual code — every claim
cites a file. Treat the repository as the source of truth; update this doc when
controls change.

> Companion docs: `docs/ROLES_AND_PERMISSIONS.md` (RBAC), `docs/DPDP_COMPLIANCE.md`
> (privacy), `docs/BACKUP_DR.md` (recovery), `docs/MONITORING.md` (observability),
> `docs/EMAIL_SETUP.md` (SMTP).

---

## 1. Authentication

| Control | Status | Where |
|---|---|---|
| Password hashing — bcrypt, 10 rounds | ✅ | `backend/src/utils/password.ts` |
| JWT access tokens (short-lived, 15m default) | ✅ | `backend/src/utils/jwt.ts`, `config/env.ts` (`jwtAccessTtl`) |
| Opaque refresh tokens, **SHA-256 hashed at rest**, rotation + reuse detection (family revocation) | ✅ | `backend/src/modules/auth/auth.service.ts`, migration `0001` / refresh tokens |
| Account lockout (5 failed / 15 min, admin unlock) | ✅ | `auth.service.ts`, migration `0046_account_lockout.sql`, `config/env.ts` |
| Password-reset tokens — **SHA-256 hashed**, single-use (`used_at`), 60 min TTL | ✅ | `auth.service.ts`, migration `0044_password_reset_tokens.sql` |
| 2FA TOTP (authenticator app), admin reset path | ✅ | `auth.service.ts`, migration `0045_two_factor.sql`, `users.routes.ts` `POST /:id/disable-2fa` |
| Session list / per-device revoke (user-agent, last-used) | ✅ | migration `0047_session_metadata.sql`, `GET/DELETE /auth/sessions` |
| Login enumeration safety (uniform responses) | ✅ | `auth.service.ts`, `/auth/forgot-password` always 200 |
| httpOnly + `secure` (prod) + `SameSite=Lax` cookies (portal) | ✅ | `backend/src/utils/cookies.ts` |

**Verdict — token storage:** **YES, tokens are hashed.** Refresh tokens, password-reset
tokens, and API keys are all stored as SHA-256 hashes; passwords are bcrypt hashes.
Access tokens are stateless JWTs (not stored). See the table in
`docs/SAAS_READINESS_AUDIT.md` for the per-token table/column breakdown.

### Gaps (auth)
- **2FA recovery codes** — not implemented. If a user loses their authenticator,
  recovery depends on an admin reset (`POST /users/:id/disable-2fa`). *P1.*
- **Admin-created-password strength** — the self-service change/reset path enforces
  8+ chars with a letter and a digit (`auth.schema.ts`); the admin "create user"
  path should enforce the same policy. *P2.*

---

## 2. Authorization (RBAC) & Multi-tenant isolation

| Control | Status | Where |
|---|---|---|
| Role model (`super_admin, admin, teacher, accountant, student, parent`) | ✅ | `backend/src/types/index.ts` |
| Granular `module:action` permissions, seeded catalogue, 60s cache w/ explicit invalidation | ✅ | `middleware/permissions.ts`, migrations `0012_permissions.sql`, `0042_rbac.sql` |
| `authorize(...roles)` and `requirePermission(key)` guards | ✅ | `middleware/auth.ts`, `middleware/permissions.ts` |
| Tenant guard — `requireTenant` / `tenantId(req)`; **super_admin is rejected from tenant routes** | ✅ | `middleware/tenant.ts` |
| `institution_id` scoping in data layers (direct column or via `student_id → students.institution_id`) | ✅ | service queries across modules |
| Owner-scoping for students/parents (own record / own children) | ✅ | `backend/src/utils/scope.ts` |
| Institution-type guard (school vs college), super_admin bypass, cached | ✅ | `middleware/institution-type.ts` |
| File uploads namespaced by institution + owner; download authorization | ✅ | `modules/documents/documents.service.ts` |
| Platform (super-admin) surface fully separated under `/platform/*` | ✅ | `modules/platform/*` |
| Cross-tenant isolation integration tests | ✅ | `backend/tests/integration/isolation.int.test.ts` (+ `access`, `rbac`, `permissions`) |

**Verdict — tenant isolation:** **YES**, with one bug found and fixed in this pass
(see §6, AI assistant). The architecture is sound: tenant = institution, scoped at
the query layer, super_admin cannot read tenant data through tenant routes.

### Gaps (authz)
- **AI MongoDB conversations** were scoped by `userId` only (safe because `userId`
  is a globally-unique UUID, but not defense-in-depth). Now also stamped with
  `institutionId` on write. *Fixed (P2).*

---

## 3. Transport, headers & web hardening

| Control | Status | Where |
|---|---|---|
| TLS 1.2/1.3, HTTP/2, HSTS (1y), Let's Encrypt | ✅ (prod) | `infra/nginx/production.conf` |
| `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` | ✅ | nginx (prod+dev), Helmet, Next.js headers |
| Helmet middleware | ✅ | `backend/src/app.ts` |
| **Content-Security-Policy (backend)** — `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (Swagger-compatible) | ✅ *(added)* | `backend/src/app.ts` |
| **Frontend security headers** — CSP `frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `Permissions-Policy`, `X-Frame-Options`, `Referrer-Policy`, nosniff | ✅ *(added)* | `frontend/next.config.mjs` |
| Strict CORS allow-list, `credentials: true`, env-driven | ✅ | `app.ts`, `config/env.ts` (`corsOrigin`) |
| Rate limiting — global (300/15m) + stricter auth (10 failures/15m) | ✅ | `middleware/rate-limit.ts` |
| Body limit (1MB JSON); upload limit (`STORAGE_MAX_MB`, default 10MB); nginx `client_max_body_size 10m` | ✅ | `app.ts`, `modules/documents/documents.routes.ts`, nginx |
| File-upload validation — MIME allow-list + dangerous-extension block + MIME↔ext match + size | ✅ | `modules/documents/documents.service.ts` |
| Fail-fast secret validation (rejects published dev JWT secrets in prod) | ✅ | `config/env.ts` (`requiredSecret`) |
| Error responses hide stack traces in production | ✅ | `middleware/error.ts` |
| No secrets in the frontend bundle (only `NEXT_PUBLIC_API_URL`) | ✅ | `frontend/.env.example`, `lib/api.ts` |
| Payment webhook HMAC verification on raw body | ✅ | `modules/onlinepayments/*`, raw-body capture in `app.ts` |

### CSRF
The staff SPA and mobile app authenticate with **Bearer tokens** (not CSRF-prone —
browsers don't auto-attach them). The **student/parent portal** uses httpOnly
cookies, which `SameSite=Lax` already protects against cross-site
`POST/PUT/PATCH/DELETE`. As **defense-in-depth**, a CSRF origin guard was added:

- `backend/src/middleware/csrf.ts` (`csrfOriginGuard`), mounted on the API router
  in `app.ts`. For unsafe methods authenticated **via cookie**, it requires the
  `Origin`/`Referer` to be in the CORS allow-list. Bearer-token clients,
  server-to-server callers (payment/webhook receivers, biometric device ingest,
  `x-api-key` `/ext`), and native clients that omit `Origin` pass through
  unaffected. Unit-tested in `backend/src/middleware/csrf.test.ts`.

### Gaps (web hardening)
- **Full nonce-based CSP** for the frontend (`script-src`/`connect-src`) is not yet
  enabled — it requires threading a per-response nonce through the Next.js App
  Router and pinning the API origin, so the inline theme-boot script and
  cross-origin API calls keep working. The safe subset is shipped now. *P1.*
- **CSP in nginx** — the production nginx config (server-local per `CLAUDE.md`)
  should also send a CSP; mirror the app-level policy when tightening. *P1.*
- **Rate-limit store is in-memory** — fine for a single instance; a multi-instance
  deployment needs a shared store (e.g. Redis). *P2.*
- **No per-tenant / per-API-key rate limiting** — a noisy tenant shares the global
  bucket. *P1 for scale.*

---

## 4. Audit & accountability

| Control | Status | Where |
|---|---|---|
| Durable platform (super-admin) audit — lifecycle, subscription, impersonation | ✅ | migration `0039_platform_hardening.sql`, `modules/platform/platform.service.ts` |
| **Durable security audit** — login success/failure, password reset request/complete, password change, 2FA enable/disable, admin 2FA-reset, admin unlock, user create/deactivate, SMTP test | ✅ *(added)* | `backend/src/utils/security-audit.ts`, wired in `auth.routes.ts`, `users.routes.ts`, `platform.routes.ts` |
| Best-effort request audit (MongoDB, optional) | ✅ | `middleware/audit.ts` |
| Structured JSON request logs + `x-request-id` correlation + user-agent | ✅ | `middleware/request-logger.ts`, `request-context.ts` |
| Impersonation is permission-gated, cannot target super_admin, returns no secrets, fully audited | ✅ | `modules/platform/platform.service.ts` (`impersonate`) |

The durable security audit writes to `platform_audit_log` (Postgres), so it
**survives a MongoDB outage** — unlike the best-effort request log. Events are
namespaced (`auth.login.failed`, `user.2fa_reset`, …), carry `institution_id` for
tenant attribution, capture client IP (honouring `trust proxy`), and never store
secrets. Writes are best-effort and never block the originating request.

### Gaps (audit)
- **Old/new value diffs** on update events are not captured (only the action +
  identifiers). *P2.*
- **Surfacing security events to tenant admins** — currently visible via the
  super-admin platform audit viewer; a tenant-scoped security view is a follow-up. *P2.*

---

## 5. Secrets, dependencies & CI/CD

| Control | Status | Where |
|---|---|---|
| Secrets only in env / `.env.example` templates; none committed | ✅ | `.env.example` files |
| Prod refuses published dev JWT secrets (fail-fast at boot) | ✅ | `config/env.ts` |
| CI: typecheck + unit + integration (Postgres service) + build, backend & frontend | ✅ | `.github/workflows/ci.yml` |
| **CI security job — `npm audit` (backend+frontend) + gitleaks secret scan** (non-blocking) | ✅ *(added)* | `.github/workflows/ci.yml` (`security` job) |
| Deploy gated by `vars.DEPLOY_ENABLED` + `VPS_*` secrets; preserves volumes | ✅ | `.github/workflows/deploy.yml` |
| Multi-stage Docker builds; migrations auto-run on boot | ✅ | `*/Dockerfile`, `server.ts` |

The CI security job is **non-blocking** (`continue-on-error: true`) so a freshly
disclosed transitive CVE doesn't wedge the pipeline. Promote `npm audit` and
gitleaks to required checks once the baseline is confirmed clean. *P1 to enforce.*

---

## 6. Issues found and fixed in this pass

1. **AI assistant cross-tenant data leak (P1 — fixed).** `modules/ai/ai.service.ts`
   `schoolContext()` ran `count(*)`/`sum(amount)` over `students`, `teachers`,
   `classes`, `attendance_records`, `invoices`, `payments` with **no
   `institution_id` filter**, and `/ai/assistant` had **no `requireTenant`** — so a
   staff user received platform-wide aggregates (and those numbers were sent to the
   model provider). Fixed: `requireTenant` added to the AI router; every aggregate
   scoped to the caller's institution (joining through `students.institution_id`
   for `invoices`/`payments`/`attendance_records`, which carry no direct column);
   conversations now stamped with `institutionId`.

2. **No durable security audit (P1 — fixed).** Added `security-audit.ts` and wired
   12 event types across auth/user/platform routes (see §4).

3. **No CSRF defense-in-depth for cookie portal (P2 — fixed).** Added
   `csrfOriginGuard` (see §3).

4. **No CSP (P1 — partially fixed).** Backend Helmet CSP + safe frontend CSP added;
   full nonce-based frontend CSP remains a follow-up.

5. **No SMTP startup validation (P1 — fixed).** `verifyMailer()` runs at boot and
   logs configured/verified/failed; super-admins can test via
   `GET/POST /platform/email/*`. See `docs/EMAIL_SETUP.md`.

6. **No dependency/secret scanning in CI (P1 — fixed, non-blocking).** Added the
   `security` job.

---

## 7. Prioritised remaining work

**P1**
- Full nonce-based frontend CSP + nginx CSP.
- 2FA recovery codes.
- Per-tenant / per-API-key rate limiting (multi-tenant fairness).
- Promote CI `npm audit` + gitleaks to required (after baseline triage).
- Webhook signing secrets are stored in plaintext (`webhook_endpoints.secret`,
  migration `0068`). **Note:** outbound HMAC signing *requires* a recoverable
  secret — it cannot be one-way hashed like a password. The correct hardening is
  **encryption at rest** (e.g. envelope encryption with a KMS key), not hashing.
  Documented here so it is not "fixed" incorrectly.

**P2**
- Admin-create-user password policy parity.
- Audit old/new value diffs; tenant-scoped security view.
- Move rate-limit store to Redis for multi-instance.
- CORS: explicitly reject `CORS_ORIGIN=*` in production in `env.ts`.

---

## 8. Reporting a vulnerability
Email the maintainers privately (see repository owner). Do not open a public issue
for security reports. Include reproduction steps and impact; expect an
acknowledgement and a coordinated fix/disclosure timeline.
