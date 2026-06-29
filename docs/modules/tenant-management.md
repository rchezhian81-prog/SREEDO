# Tenant / Institution Management (one common, type-driven module)

Super-admin module to onboard and manage institutions of **any type** — School,
College, University, Coaching/Training, Other — from **one common module**, not
separate school/college modules. Extends the Platform Console (#106). Super-admin
only; additive migrations; **never hard-deletes a tenant**; does **not** modify
the invoice module (links to it read-only).

## Dual-type model (key design)
`CLAUDE.md`: *School vs College is structural, not cosmetic* — a cached
`requireInstitutionType()` guard + terminology engine key off `institutions.type ∈
{school, college}`. To support 4+ types **without** touching that machinery:

- **`institution_type`** (new) ∈ `school | college | university | coaching | other`
  — the tenant-facing type that drives academic structure, type-based settings,
  labels and onboarding.
- **`type`** (existing, structural) — derived on write: `school → school`;
  `college/university/coaching/other → college` (program-style structure). The
  guard, terminology engine and college/school route gating are **unchanged**.

## Lifecycle
`draft → trial → active → suspended → expired → archived`. `status` is kept in
sync with the legacy `is_active` flag (active/trial → true; others → false) so
existing auth/guards keep working. **Suspend/archive require a reason** (audited).
No hard delete — archived tenants drop out of active views but keep all history.

## What's stored where
- **Columns** (migration `0081`): `institution_type`, profile (`legal_name`,
  `short_name`, `address`, `city`, `state`, `country`, `pincode`, `phone`,
  `email`, `website`, `academic_year`, `timezone`, `currency`, `language`,
  `notes`), `slug` (unique), `status`, `onboarding` (jsonb), compliance
  (`terms_accepted`, `agreement_signed`, `kyc_status`, `approval_status`,
  `approval_remarks`, `approved_by`, `approved_at`).
- **`settings` (jsonb)**: `academicStructure`, `enabledModules`, `schoolSettings`,
  `collegeSettings`, `communication` — plus the existing `limits`/`featureFlags`.
- **`institution_notes`** (new table): internal super-admin CRM notes
  (sales/support/billing/technical/general + follow-up date). Never exposed to
  tenant users.

## Endpoints (super-admin, `/platform/tenants`)
List/export (`?q,institutionType,status,page,pageSize,sort,order` + `/export`
csv/xlsx) · `POST /tenants` (create, optional primary admin, starts draft) ·
`GET/PATCH /tenants/:id` (rich detail / profile+type update) ·
`GET /tenants/:id/billing` (read-only invoice+subscription summary) ·
`POST /tenants/:id/lifecycle` ({status, reason}) ·
`PATCH /tenants/:id/settings` (type-based config) ·
`POST /tenants/:id/onboarding/step` + `/onboarding/complete` ·
`PATCH /tenants/:id/compliance` · `POST /tenants/:id/admin` +
`PATCH /tenants/:id/admin/:userId` (enable/disable) ·
`GET/POST /tenants/:id/notes`, `PATCH/DELETE /tenants/notes/:noteId`.
All sensitive actions audit to `platform_audit_log` (`tenant.*` actions);
super-admin-only; parameterized SQL.

## Onboarding
Checklist with **completion %** — steps derived from **real data** where possible
(profile complete, academic structure set, primary admin exists, subscription
assigned, limits set, slug set, status≠draft) plus manual toggles
(branding/communication) in the `onboarding` jsonb. `complete` activates a draft.

## Primary admin
Created with a **cryptographically-random password** (never returned); the admin
sets their own via the password-reset flow — no guessable default. Enable/disable
supported. Duplicate email → 409.

## UI (super-admin → Tenants)
- **List** (`/super-admin/platform/tenants`): search + type/status filters, sort,
  pagination, CSV/XLSX export, create.
- **Create/onboarding** (`/tenants/new`): identity (name/code/type), contact,
  optional primary admin.
- **Detail** (`/tenants/[id]`): tabbed — Overview, Profile, Academic & Settings
  (type-based school/college config + academic-structure JSON + communication
  defaults), Modules
  (enable/disable), Subscription & Billing (read-only + link to invoices), Limits
  & Usage, Branding & Domain (slug + link to branding), Onboarding (checklist +
  %), Compliance/approval, Admins, Notes (CRM), Audit (timeline + link). Lifecycle
  actions + Support-access shortcut in the header.

## Linked (not rebuilt)
Branding module (logo/theme), Documents module (file upload), Communication
(notification preferences), subscription/packages/limits, the invoice module
(read-only billing summary), platform audit + support access (#106), students/staff
import endpoints.

## Deferred (honestly — no faking)
Custom-domain **DNS/SSL automation** (no infra — slug is stored for routing only);
a full **import engine** (link to existing import shortcuts only); **backup**
infrastructure; **WhatsApp** config. Per-tenant **communication defaults** (sender
name, reply-to, SMS sender ID, channel toggles) are editable in the Academic &
Settings tab; a tenant **document-upload** UI reuses the documents module and is a
thin follow-up.

## Migration
`0081_tenant_management.sql` — additive columns + backfill (`institution_type =
type`, `status` from `is_active`, `slug` from `code`) + `institution_notes` table +
indexes (`institution_type`, `status`, unique `slug`). Applies on boot via
`runMigrations()`. No existing column dropped; no data deleted.

## Tests
`backend/tests/integration/tenant.int.test.ts` (13): create (type derivation),
duplicate-code + RBAC, profile update + re-derive, lifecycle + is_active sync +
reason guard, type-based settings, onboarding progress + complete, primary admin
(no leak) + toggle, internal notes + tenant-user denial, compliance + approver
stamp, read-only billing summary, list/filter/paginate/export, rich detail +
audit + no-hard-delete.
