# SaaS Subscription & Billing — Current State and Phased Roadmap

This is a phased implementation plan for turning the existing subscription
*scaffolding* into a production SaaS billing system. It is deliberately a plan,
not an implementation: **no payment gateway is wired for SaaS billing, and none
should be until live credentials, pricing, tax registration, and dunning rules
are available** (project rule: "Do not integrate payment gateway unless
credentials and business rules are available").

> Scope note: "Billing" here means **the SaaS operator charging institutions for
> their subscription**. It is unrelated to **student fee collection**, which is a
> mature, separate feature (`modules/fees`, `modules/onlinepayments`,
> `modules/feerefunds`) with a working pluggable gateway for *student fees*.

---

## 1. What exists today (verified)

| Capability | Status | Evidence |
|---|---|---|
| `subscription_packages` (name, max_students, max_staff, price, billing_cycle, features JSONB, is_active) | ✅ | migration `0011_tenancy.sql` |
| `institution_subscriptions` (institution_id, package_id, status, starts_at, ends_at) | ✅ | migration `0011_tenancy.sql` |
| Super-admin CRUD for packages & subscription assignment | ✅ | `modules/superadmin/*`, `modules/platform/*` (`POST /platform/institutions/:id/subscription`) |
| Suspend / activate an institution (manual) | ✅ | `platform.service.ts` (`suspendInstitution`/`activateInstitution`) — audited |
| Plan-limit enforcement at creation time (students, staff) | ✅ (partial) | `backend/src/utils/plan-limits.ts` (`assertWithinPlanLimit`) |
| Per-institution feature limits (set via platform) | ✅ (stored) | `PATCH /platform/institutions/:id/limits` |
| Platform KPIs incl. fees outstanding, online payments total | ✅ | `GET /platform/kpis` |

**Status statuses in use:** `active`, `trialing`, `suspended`, `cancelled` —
but transitions are **manual** (a super-admin acts); nothing automated.

## 2. What's missing for production SaaS billing

| Gap | Impact | Priority |
|---|---|---|
| **No renewal/expiry automation** — nothing transitions `active → expired` after `ends_at`; no auto-suspend; no reminders | Expired tenants stay fully active | **P0** |
| **No SaaS invoices** — `invoices` table is *student fees* only; no subscription invoice, line items, numbering, or PDF | Can't bill or give receipts | **P0** |
| **No recurring charging** — the gateway adapter serves student fees; no customer/subscription tokens for the operator | Can't auto-charge licences | **P0** (deferred until creds) |
| **No tax/GST** — no tax % on packages, no tax amount, no GSTIN on institution | Non-compliant invoices in India | **P1** |
| **Storage / feature / report limits stored but not enforced** | Customers exceed plan silently | **P1** |
| **No per-tenant rate limiting / metering** | Noisy tenant affects others | **P1** |
| **No grace period, dunning, trial→paid conversion, churn/reactivation** | Manual lifecycle ops | **P1** |
| **No revenue reporting (MRR/ARR, deferred revenue)** | No financial visibility | **P2** |

---

## 3. Phased plan

Each phase is independently shippable, backward-compatible, and uses **safe,
additive migrations only** (new tables/columns; never edit an applied migration).

### Phase B1 — Lifecycle automation (no payment gateway needed) — **P0**
Make subscriptions *enforce* themselves. Lowest risk, highest value, fully doable
now without any external billing provider.

- **Migration** `00xx_subscription_lifecycle.sql` (additive):
  - `institution_subscriptions`: add `renews_at DATE`, `grace_until DATE`,
    `trial_ends_at DATE`, `auto_renew BOOLEAN DEFAULT true`,
    `last_reminder_at TIMESTAMPTZ`.
- **Background job** (use the existing Postgres-backed worker —
  `modules/jobs/jobs.worker.ts`, already supports scheduled ticks):
  - Daily tick: for each subscription past `ends_at` + `grace_until`, set status
    `expired` and (configurably) suspend the institution; emit a webhook
    (`subscription.expired`) and a `platform_audit_log` entry.
  - Reminder ticks at T-14/T-7/T-1 days → email via `mailer.ts`
    (degrades gracefully if SMTP unset; see `docs/EMAIL_SETUP.md`).
  - Trial expiry: `trialing` past `trial_ends_at` → `expired` (or `active` if a
    paid plan is attached).
- **Enforcement hook:** extend `requireInstitutionType`/a new
  `requireActiveSubscription` middleware (cached, super_admin bypass) to return a
  clear `402 Payment Required`/`403` on suspended/expired tenants — **read-only
  allowances** so a locked-out school can still export its data (DPDP/portability).
- **UI:** super-admin sees renewal/grace/trial dates and a "send reminder"/
  "extend grace" action; institution admin sees a renewal banner.
- **Tests:** integration tests for the daily tick transitions + the enforcement
  middleware (allow read-only, block writes when expired).

### Phase B2 — SaaS invoicing (still no gateway) — **P0/P1**
Generate invoices/receipts for offline/manual payment (bank transfer, cheque) —
the common path for Indian schools before any online card billing.

- **Migration** `00xx_saas_invoices.sql` (additive, namespaced to avoid clashing
  with student `invoices`): `saas_invoices` (institution_id, number sequence,
  period_start/end, currency, subtotal, tax_percent, tax_amount, total, status:
  `draft|issued|paid|void`, issued_at, paid_at, payment_method, notes) and
  `saas_invoice_lines` (description, qty, unit_price, amount).
- **Service/routes** under `/platform/billing/*` (super-admin): create/issue/
  mark-paid/void; list per institution; PDF via the existing PDF pipeline
  (`modules/pdfs`).
- **Tax/GST (P1):** add `gstin` to institution profile, `tax_percent` to packages,
  compute tax on invoices; configurable place-of-supply. Keep India-specific
  fields optional for non-India tenants.
- **Tests:** invoice numbering monotonicity, tax math, tenant scoping.

### Phase B3 — Plan-limit enforcement completeness — **P1** — ✅ SHIPPED
- ✅ **Storage** enforced on upload: `assertStorageWithinLimit` in
  `utils/plan-limits.ts` (sums `documents` + `tenant_documents` byte sizes vs the
  effective `storageLimitMb`) is called from `documents.service.createDocument`.
- ✅ **Feature flags:** `middleware/feature-flag.ts` (`requireFeature`, cached,
  super_admin bypass, **default-allow** — a module is blocked only when
  `settings.featureFlags[key] === false`). Wired to the optional Live Classes and
  AI Insights modules; the cache is busted when a tenant's settings change.
- ✅ **Report quota:** `assertScheduledReportQuota` (effective
  `scheduledReportsQuota`) enforced in `scheduledreports.service.createSchedule`.
- ✅ **Usage vs limit surfaced:** `adminconsole.institutionLimits` and the platform
  tenant detail now return `storageUsedMb` + scheduled-report counts; the
  super-admin tenant **Plan limits & usage** tab shows storage & scheduled-report
  usage with over/near-limit badges.
- ✅ **Per-tenant rate limiting:** `tenantRateLimiter` (keyed by `institution_id`,
  `TENANT_RATE_LIMIT_MAX`) mounted on the API-key `/ext` surface so one leaked key
  can't starve other tenants. In-memory today; swap in a shared store (Redis) when
  multi-instance.
- ✅ **Tests:** `tests/integration/plan-limits.int.test.ts` (storage block/allow,
  scheduled-report quota, feature-flag gate, per-tenant `/ext` limiter isolation).
- No migration required — all additive (JSONB limit overrides, computed usage,
  in-memory limiter).

### Phase B4 — Online recurring billing (ONLY with credentials + rules) — **P0 (gated)**
Do **not** start until the operator provides: gateway account + API keys, the
price book, currency/tax rules, trial policy, dunning/retry policy, and refund
policy.

- Reuse the **adapter pattern** already proven in `modules/onlinepayments/gateway.ts`
  (provider-agnostic, HMAC webhook verification, idempotent events) — extend it
  with subscription/customer objects.
- Store gateway customer/subscription references on `institution_subscriptions`
  (additive columns), never store card data (use hosted checkout / tokens).
- Webhook-driven state: `invoice.paid` → mark paid + extend `renews_at`;
  `payment.failed` → enter dunning (retry schedule) → suspend after N failures.
- **Security:** verify webhook signatures on the raw body (the app already
  captures `rawBody`); audit every billing event.
- **Tests:** webhook idempotency, signature rejection, dunning state machine.

### Phase B5 — Revenue reporting — **P2**
MRR/ARR, active vs trialing vs churned, deferred revenue recognition; surface on
the platform dashboard alongside existing KPIs.

---

## 4. Migration safety checklist (applies to every phase)
- New numbered migration files only; never edit an applied one (`CLAUDE.md`).
- Additive columns with sensible defaults; backfill in the same migration where
  needed; preserve existing rows.
- `runMigrations()` applies on boot (`server.ts`) — test against a disposable
  Postgres via `npm run test:integration` before merging.
- Feature-flag new enforcement so it can be rolled out per environment and rolled
  back without data loss.

## 5. Explicitly out of scope right now
- No live payment gateway integration (no credentials/rules) — **B4 is a plan**.
- No automatic destructive action on tenants (suspension is reversible and
  audited; data is retained, never deleted).
