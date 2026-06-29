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
List/export (`?q,institutionType,status,package,createdFrom,createdTo,page,
pageSize,sort,order` + `/export` csv/xlsx) · `POST /tenants` (create, optional
primary admin, starts draft) · `GET/PATCH /tenants/:id` (rich detail / profile+type
update) · `GET /tenants/:id/billing` (read-only invoice+subscription summary) ·
`GET /tenants/:id/health` (real-data health snapshot) ·
`POST /tenants/:id/lifecycle` ({status, reason}; suspend/archive/close require a
reason) · `PATCH /tenants/:id/settings` (type-based config) ·
`PATCH /tenants/:id/branding` (display name/logo URL/colour/tagline) ·
`PATCH /tenants/:id/crm` (account manager, last contacted) ·
`POST /tenants/:id/onboarding/step` + `/onboarding/complete` ({override?}) ·
`PATCH /tenants/:id/compliance` · `POST /tenants/:id/admin` +
`PATCH /tenants/:id/admin/:userId` (enable/disable) +
`POST /tenants/:id/admin/:userId/reset-link` (email setup/reset link) ·
`GET/POST /tenants/:id/documents`, `GET …/:docId/download`,
`PATCH …/:docId/verify`, `POST …/:docId/archive`, `DELETE …/:docId` ·
`GET /tenants/:id/export` + `/tenants/:id/users/export` (csv/xlsx) ·
`GET/POST /tenants/:id/notes`, `PATCH/DELETE /tenants/notes/:noteId`.
Subscription assign/change, status, events and limits reuse the existing
`/platform/institutions/:id/subscription[...]` + `/limits` endpoints; support access
reuses `/platform/users` + `/platform/impersonate[...]`. All sensitive actions audit
to `platform_audit_log` (`tenant.*` actions); super-admin-only; parameterized SQL.

## Onboarding
Checklist with **completion %** — steps derived from **real data** where possible
(profile complete, academic structure set, primary admin exists, subscription
assigned, limits set, slug set, documents uploaded, status≠draft) plus manual
toggles (branding/communication) in the `onboarding` jsonb. Required steps
(profile, academic structure, primary admin, slug) **block activation** until done
— a super-admin may `complete` with `{override:true}` (recorded in the audit).

## Primary admin
Created with a **cryptographically-random password** (never returned) and emailed a
**password-setup/reset link** (best-effort; no-op + reported when SMTP is off) so
the account is immediately usable. Enable/disable + re-send setup link supported.
Duplicate email → 409. A true pending-**invite** flow is deferred (no infra).

## UI (super-admin → Tenants)
- **List** (`/super-admin/platform/tenants`): search + type/status/package/
  created-date filters, sort, pagination, CSV/XLSX export, create.
- **Create/onboarding** (`/tenants/new`): identity (name/code/type), contact,
  optional primary admin.
- **Detail** (`/tenants/[id]`): 17 tabs — Overview (KPIs + export/exit), Profile,
  Onboarding (checklist/%/required/override), Academic Structure (per-type presets
  + JSON), Settings (full school/college type-based config), Modules, Admins
  (status, last-active, add, enable/disable, setup-link), Subscription & Billing
  (read-only summary + assign/change package + status/events + invoices link),
  Limits & Usage (editable overrides + near/over-limit + overdue warnings),
  Branding & Domain (slug + URL preview/open + display name/logo/colour/tagline),
  Documents (upload/verify/archive/delete/download), Communication (sender identity
  + channels + test email), Health (live metrics), Compliance (terms/agreement/
  consent/KYC/approval), Notes (CRM owner + internal notes), Support (inline user
  search + reason + start/end impersonation), Audit (timeline + link). Lifecycle
  actions (activate/trial/suspend/expire/reactivate/archive/close) in the header.
- The legacy `/super-admin/platform/institutions[/new|/:id]` pages now **redirect**
  here so there is **one** entry point.

## Linked (not rebuilt)
Branding table (`institution_branding`), the shared storage layer + file validator
(reused for tenant documents), the auth password-reset flow (admin setup links),
subscription/packages/limits + `subscription_events`, the invoice module (read-only
billing summary), platform audit + support access/impersonation (#106),
students/staff import endpoints, the email service (`mailer`).

## Deferred (honestly — no faking)
Custom-domain **DNS/SSL automation** (no infra — slug is stored for routing only);
a full **import engine** (students/staff import exist and are linked; classes/fees
import don't) and **CSV→JSON parsing**; **backup** infrastructure; a real pending
**invite** flow (setup/reset links are used instead); **logo file upload** from the
super-admin surface (set logo URL here; file upload runs in the tenant app); and
metrics with **no backing data** (per-user last-login, SMS/email send counts,
failed-login history) — intentionally omitted from Health rather than faked.

## Migration
`0081_tenant_management.sql` — additive columns + backfill (`institution_type =
type`, `status` from `is_active`, `slug` from `code`) + `institution_notes` table +
indexes (`institution_type`, `status`, unique `slug`).
`0082_tenant_documents_extras.sql` — adds the `closed` lifecycle status (recreates
the named status CHECK), CRM/consent columns (`account_manager`,
`last_contacted_at`, `data_processing_consent`), and the `tenant_documents` table
(+ index). Both additive — applied on boot via `runMigrations()`; no existing column
dropped, no data deleted, no tenant hard-deleted.

## Tests
`backend/tests/integration/tenant.int.test.ts` (23): create (type derivation),
duplicate-code + RBAC, profile update + re-derive, lifecycle + is_active sync +
reason guard, `closed` status, type-based settings (incl. communication/WhatsApp),
onboarding progress + complete + required-step enforcement + override, primary admin
(no leak) + toggle + setup-link, internal notes + tenant-user denial, CRM fields,
branding, compliance + consent + approver stamp, read-only billing summary, health
snapshot, documents (upload/verify/download/archive/delete + RBAC + bad-type
reject), profile/users export, list/filter (type/package/created-date)/paginate/
export, rich detail + audit + no-hard-delete.
