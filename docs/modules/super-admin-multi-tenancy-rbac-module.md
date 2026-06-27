# Super Admin, Multi-Tenancy & RBAC Module

> **Status:** Implemented · **Backend:** `backend/src/modules/platform` (+ `superadmin/`, `adminconsole/`) and the core RBAC/tenant middleware (`backend/src/middleware/{permissions,tenant,auth}.ts`) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Architecture](../ARCHITECTURE.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

This is the **key architecture module** for the platform. It covers three tightly
coupled concerns:

1. **Super-admin platform console** — managing institutions, branches,
   subscription packages/limits, a cross-tenant audit log, and support
   impersonation, all above any single tenant.
2. **Multi-tenancy** — every domain table carries an `institution_id`; the
   `requireTenant` / `tenantId` middleware scopes tenant routes to the caller's
   institution, while platform routes are deliberately **not** tenant-scoped.
3. **RBAC** — a `module:action` permission catalogue plus a role→permission matrix
   in `permissions` + `role_permissions`, enforced by `requirePermission(key)`
   (short-TTL cached, invalidated on grant/revoke), with a super-admin RBAC console
   to view and edit grants.

GoCampus is the public brand (gocampusos.com); `sreedo` is the internal db
identity (e.g. the bootstrap Postgres superuser).

## 2. User roles involved

- **super_admin** — the platform god role. `institution_id` is **NULL**, it is
  cross-tenant, it **bypasses** `requirePermission` checks at runtime, and its
  `platform:*` grants are protected from revocation. It operates via the
  `/super-admin` console, not a single school's data.
- **admin** — tenant administrator; full control within their own institution.
- **teacher / accountant** — staff roles, scoped to their tenant; permission set
  varies by module.
- **student / parent** — portal roles; owner-scoped to their own / linked-child
  data.

The six manageable roles in the RBAC console are: `super_admin`, `admin`,
`teacher`, `accountant`, `student`, `parent`.

## 3. Main screens / pages

Under `frontend/src/app/(dashboard)/super-admin/`:

- `platform/page.tsx` — platform KPIs / overview.
- `platform/institutions/page.tsx`, `.../new/page.tsx`, `.../[id]/page.tsx` —
  institution list, create, and detail (profile + limits + usage + lifecycle).
- `platform/audit/page.tsx` — cross-tenant audit log viewer with filters.
- `platform/support/page.tsx` — support impersonation.
- `rbac/page.tsx` — permission catalogue + role matrix + grant/revoke.
- `packages/page.tsx` — subscription packages.
- `settings/page.tsx`, `health/page.tsx`, `observability/page.tsx`,
  `exports/page.tsx`, `audit-logs/page.tsx`, `backups/page.tsx`, `jobs/page.tsx`.

## 4. Main backend APIs

Under `/api/v1/platform`, guarded by `authenticate` + `authorize("super_admin")`
(hard role boundary) and granular `platform:*` permissions.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/platform/kpis` | Platform-wide KPIs + module adoption | `platform:usage_read` |
| GET | `/platform/health` | Platform health (DB/Mongo/counts/uptime) | `platform:health_read` |
| GET | `/platform/audit` | Cross-tenant audit log (read-only, filterable) | `platform:audit_read` |
| POST | `/platform/impersonate` | Start a scoped, audited support impersonation | `platform:impersonate` |
| GET | `/platform/institutions` | List institutions with status + usage | `platform:read` |
| POST | `/platform/institutions` | Create an institution (audited) | `platform:manage_institutions` |
| GET | `/platform/institutions/{id}` | Institution detail (profile + limits + usage) | `platform:read` |
| PATCH | `/platform/institutions/{id}` | Update profile / `type` (audited) | `platform:manage_institutions` |
| POST | `/platform/institutions/{id}/suspend` | Suspend (audited) | `platform:manage_institutions` |
| POST | `/platform/institutions/{id}/activate` | Activate (audited) | `platform:manage_institutions` |
| POST | `/platform/institutions/{id}/subscription` | Assign a package (audited) | `platform:manage_subscriptions` |
| PATCH | `/platform/institutions/{id}/limits` | Set per-institution feature limits (audited) | `platform:manage_subscriptions` |
| GET | `/platform/permissions` | Permission catalogue grouped by module (+ roles holding each) | `platform:permissions_read` |
| GET | `/platform/roles` | Role → permission matrix | `platform:rbac_read` |
| POST | `/platform/roles/{role}/permissions` | Grant a permission to a role (cache-invalidated + audited) | `platform:rbac_manage` |
| POST | `/platform/roles/{role}/permissions/revoke` | Revoke a permission (protects super_admin `platform:*`; audited) | `platform:rbac_manage` |

Adjacent surfaces: `superAdminRouter` serves `/institutions`, `/branches`,
`/packages`; `adminConsoleRouter` is mounted at `/admin`. The platform module
reuses `superadmin`/`adminconsole` services for institution CRUD, limits, and
stats so validation never drifts.

## 5. Database tables / entities

Tenancy + RBAC core (migrations `0011_tenancy.sql`, `0012_permissions.sql`,
`0030/0039_*_hardening.sql`, `0042_rbac.sql`):

- **`institutions`** — the tenant root (`id`, `name`, `code`, `type`
  school/college, `is_active`, `settings` jsonb holding `featureFlags` and
  `limits`). Domain tables reference it via `institution_id`.
- **`branches`** — sub-units within an institution.
- **`subscription_packages`** — sellable plans (`max_students`, `max_staff`,
  `price`, `billing_cycle`).
- **`institution_subscriptions`** — an institution's assigned package(s).
- **`permissions`** — the catalogue: `key` (`module:action`) + `description`.
- **`role_permissions`** — the role→permission matrix (`role`, `permission_id`).
  Global reference data (NOT tenant-scoped).
- **`platform_audit_log`** — durable cross-tenant audit: `action`, `target_type`,
  `target_id`, `institution_id`, `actor_id/email/role`, `detail` (curated,
  non-secret jsonb), `ip`, `created_at`.

`institution_id` was added to domain tables in migrations ~0013–0014, with a
`DEFAULT` institution backfilled for existing rows.

## 6. Permissions / RBAC involved

Permission keys are `module:action` strings. Platform keys
(`0039_platform_hardening.sql` + `0042_rbac.sql`): `platform:read`,
`platform:manage_institutions`, `platform:manage_subscriptions`,
`platform:audit_read`, `platform:health_read`, `platform:impersonate`,
`platform:usage_read`, `platform:rbac_read`, `platform:rbac_manage`,
`platform:permissions_read`, `platform:permissions_manage` (reserved). All are
granted only to `super_admin`; no tenant role receives any `platform:*` key.

**Enforcement model:**

- `requirePermission(key)` runs after `authenticate`. `super_admin` bypasses
  immediately; otherwise the caller's role must hold `key` in the cached
  role→permission map, else 403.
- The cache (`backend/src/middleware/permissions.ts`) has a ~60s TTL and is
  cleared by `invalidatePermissionCache()` on every grant/revoke, so authz changes
  apply immediately without a restart.
- `permissionsForRole(role)` resolves the effective set: for `super_admin` it
  returns the full catalogue; for others, the explicit grants.

**Grant/revoke (RBAC console):**

- `grantRolePermission` inserts `(role, permission_id)` idempotently
  (`ON CONFLICT DO NOTHING`), invalidates both the permission cache and the
  `rbac:` catalogue/matrix cache, and writes an `rbac.grant` audit row.
- `revokeRolePermission` deletes the row, but **refuses** to revoke any
  `platform:*` key from `super_admin` (`isCriticalForSuperAdmin` → 400), so the
  platform can never lose its own control surface. Writes an `rbac.revoke` audit row.
- The catalogue and matrix are cached under the shared `rbac:` namespace (60s),
  dropped whenever a grant/revoke lands.

## 7. Tenant isolation notes

This module **defines** the tenancy model the rest of the system relies on:

- Every domain table has `institution_id UUID`. Tenant services filter on it via
  `tenantId(req)`.
- `requireTenant(req)` rejects callers with a null institution (403 "Institution
  context required"). Because `super_admin.institution_id` is NULL, super-admin is
  intentionally rejected from tenant routes — it works only through the
  not-tenant-scoped platform console (`authorize("super_admin")`).
- Platform routes (`/platform/*`, `/backups`, `/observability`, `/admin`) are
  cross-tenant by design and are gated by `authorize("super_admin")` + granular
  `platform:*` / `backup:*` / `observability:*` keys instead of `requireTenant`.
- Tests confirm a tenant admin can never see another institution's data, and that
  the only cross-tenant surface is the super-admin platform routes (all 403 for
  tenant roles). Institution detail and audit output expose no
  `password|secret|token` material.

## 8. Key workflows

1. **Provision a tenant** — `POST /platform/institutions` (audited
   `institution.create`), then assign a subscription
   (`POST .../subscription`) and optional limits (`PATCH .../limits`,
   stored in `institutions.settings.limits`).
2. **Lifecycle** — suspend/activate toggles `is_active` (audited
   `institution.suspend` / `institution.activate`); update edits profile/type.
3. **Switch school↔college** — `PATCH /platform/institutions/{id}` can set `type`
   (a tenant admin can also flip their own via the College module, see
   [college-mode-module](college-mode-module.md)).
4. **RBAC change** — grant or revoke a `module:action` key for a role; the change
   is cache-invalidated (immediate) and audited. Revoking a critical
   `super_admin` `platform:*` key is blocked.
5. **Support impersonation** — `POST /platform/impersonate { userId, reason }`
   returns a **scoped JWT** for the target tenant user plus safe identity fields
   only (never the password hash / refresh token). Impersonating a `super_admin`
   or a non-tenant user is rejected. Audited as `impersonate.start`.
6. **Audit review** — `GET /platform/audit` is a read-only, durable, cross-tenant
   viewer filterable by institution/actor/action/target/date.

## 9. Test coverage summary

- `platform.int.test.ts` — list/deny institutions (all tenant roles 403); create +
  audit; suspend/activate + audit; profile update + subscription assign + audit;
  per-institution limits + audit; platform KPIs + module adoption; filtered audit
  viewer; audited impersonation that yields a working tenant token and leaks no
  secrets; refusing to impersonate a super_admin; cross-tenant data kept off the
  tenant surface; no secrets in detail.
- `rbac.int.test.ts` — catalogue grouped by module with roles; role matrix; grant
  then revoke with **immediate** effect (cache invalidated); idempotent duplicate
  grants; rejecting an unknown permission; **protecting super_admin's
  `platform:rbac_manage` from revocation**; durable grant/revoke audit entries;
  denying all tenant roles; and no secrets in catalogue/matrix/audit output.
- `permissions.int.test.ts`, `tenancy.int.test.ts`, `isolation.int.test.ts`,
  `access.int.test.ts` exercise the enforcement + tenant-isolation foundations.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Super admin gets 403 on a tenant route (e.g. `/students`) | `requireTenant` rejects null-tenant super admin | Use the `/platform` console or impersonate a tenant user |
| Tenant admin gets 403 on `/platform/*` | No tenant role holds `platform:*` | Expected; platform routes are super-admin only |
| A new grant doesn't take effect immediately | Stale permission cache (rare) | Grant/revoke already invalidates the cache; cache TTL is ~60s otherwise |
| Revoke returns 400 "critical platform permission" | Trying to remove a `super_admin` `platform:*` key | Blocked by design; cannot remove the platform's control surface |
| Impersonation returns 400 | Target is a super_admin or has no institution | Impersonate only tenant users |
| Cross-tenant data appears to leak | Missing `institution_id` filter / `requireTenant` in a new module | New tenant modules must apply `requireTenant` + filter every query on `tenantId(req)` |

## 11. Future enhancement notes

- Per-tenant custom roles (the matrix is currently global across institutions).
- Time-boxed / auto-expiring impersonation sessions with an explicit "end
  impersonation" action.
- Enforce subscription limits (`maxStudents`, etc.) at write time, not just store
  them.
- `platform:permissions_manage` is reserved — a future catalogue editor.
- Items marked "(to confirm)": none — behaviour maps to `platform.routes.ts`,
  `platform.service.ts`, the `permissions`/`tenant`/`auth` middleware, and the
  platform/rbac integration tests.
