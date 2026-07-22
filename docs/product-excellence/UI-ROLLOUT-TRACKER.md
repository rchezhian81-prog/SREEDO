# UI Modernization Rollout Tracker

Single source of truth for the phased GoCampus UI/UX modernization.

## Status

| PR | Scope | State |
|----|-------|-------|
| PR-UI1 | Design tokens + shared foundations (dormant `.ui-v2`, self-hosted fonts, Tailwind mapping, 4 primitives, guard, tests, docs) | Merged #175 · prod-dormant |
| PR-UI2 | Theme engine (two-gate activation, audited Layer-2 tenant flag, `/auth/me.uiV2Enabled`, no-flash render gate, eligible-only light default) | Merged #176 · prod-stable, dormant |
| PR-UI3 | Staff shell & navigation (Option B light / Option C dark, `sb-*` hooks, eligible-only theme-toggle a11y, deterministic Playwright shell visual-regression) | Merged #177 · prod-stable, dormant |
| PR-UI4 | Authentication experience | **Deferred — trusted pre-auth tenant context required** (no branch/PR/flag created) |
| PR-UI5 | Tenant staff Dashboard (Option B light / Option C dark, page-local `db-*` hooks, glass only on snapshot/needs-attention band, gold pinned-announcement accent, deterministic Playwright Dashboard visual-regression) | Merged #178 · prod-stable, dormant |
| PR-UI6 | Tenant staff Students (Option B: list + page-local Add/Edit modal, page-local `st-*` hooks, **fully solid** dark, **no glass / no gold**, eligible-only a11y, 33-baseline privacy-safe Playwright visual-regression) | Merged #179 · prod-stable, dormant |
| **PR-UI7** | Manual Fees (Option B: list + 3 page-local financial modals, page-local `fe-*` hooks, **fully solid** dark, **no glass / no gold**, eligible-only a11y, receipt/PDF/print untouched, 39-baseline privacy-safe Playwright visual-regression) — **still ships OFF** | **This PR** |
| PR-UI8+ | Further page adoption (fees setup/refunds, other modules), StatCard/Table/Tabs consolidation | Deferred |
| PR-UI8 | Role-aware mobile-navigation redesign | Deferred |

## Dormancy / safety posture (PR-UI1)

- `.ui-v2` is **never applied** in the DOM — enforced by the guard's `ui-v2-dormant`
  rule. Off-flag rendering is byte-identical (light + dark).
- No backend/API/DB/migration/RBAC/business-logic change. No `layout.tsx` change.
  No production activation.
- Reserved flag `NEXT_PUBLIC_UI_V2` (default off), not wired to any toggle.

## Theme-engine safety posture (PR-UI2)

PR-UI2 wires the engine that *can* apply `.ui-v2`, but it **still ships OFF** — the
build master switch `NEXT_PUBLIC_UI_V2` is absent in every environment and PR-UI2
does **not** create or target the `ui_v2` platform flag. Effective activation needs
**both** gates to agree:

1. **Build master** — `NEXT_PUBLIC_UI_V2 === "true"` (`isModernSkinRequested()`), and
2. **Tenant flag** — the caller's own institution is `enabled` **and** explicitly
   allow-listed in the **audited** `platform_feature_flags` registry (Layer 2),
   surfaced as the single derived boolean `uiV2Enabled` on `/auth/me`.

- **Resolver** (`backend/.../platform/feature-flag-runtime.ts`) is READ-ONLY and
  derives the tenant from the authenticated context only (`req.user.institutionId`);
  a client-supplied id is never read. Missing row / `disabled` / `rollout` /
  not-allow-listed / any DB error ⇒ **false** (fail-safe). It never mutates the
  registry — the audited super-admin setter / history / rollback are untouched.
- **/auth/me contract** adds exactly one field: `uiV2Enabled: boolean`. No raw flag,
  `allowed_tenants`, or settings is ever exposed (tenant-isolation test asserts no
  leak of another tenant's id).
- **No flash**: the dashboard holds its existing spinner until the skin decision
  latches (`useSkinStore.resolved`), so the first paint is already correct. Master
  OFF ⇒ the gate is inert and the fetch never runs — the legacy path is unchanged.
- **Light default** applies **only** to modern-eligible sessions and only when the
  user has no explicit saved theme; it reads (never writes) the theme key, so
  legacy / off-flag light↔dark resolution and the boot script are untouched.
- **Dormancy still enforced**: only the three sanctioned engine files
  (`lib/ui-flag.ts`, `stores/skin-store.ts`, `(dashboard)/layout.tsx`) may apply the
  scope class — the guard's `ui-v2-dormant` rule now also catches the `UI_V2_CLASS`
  constant, so no other file can bypass it.
- No migration, no RBAC change, no business-logic change, no production activation.

## Staff-shell safety posture (PR-UI3)

PR-UI3 restyles the authenticated **tenant staff** shell (Option B light / Option
C dark) but **still ships OFF** — it rides the PR-UI2 engine and adds no flag,
tenant targeting, or activation. Full detail: `UI-SHELL.md` +
`UI-VISUAL-REGRESSION.md`.

- **`.ui-v2`-scoped only.** Every shell rule hangs off inert `sb-*` hooks under
  `.ui-v2` in `globals.css`; a test parses the CSS and proves **no** shell rule
  escapes `.ui-v2` scope. Off-flag / super-admin / portal render unchanged.
- **Frozen surfaces.** Super-admin (shares `layout.tsx`, never gets `.ui-v2`),
  the student/parent portal (separate layout, no engine), and shared `ui.tsx` /
  `PageHeader` base styles are untouched. The command palette restyles via the
  token cascade with no file edit.
- **Theme toggle** kept + restyled; the `aria-pressed` a11y enhancement is
  eligible-session-only, legacy markup byte-identical.
- **Deterministic Playwright shell visual-regression** in CI (pinned
  `mcr.microsoft.com/playwright:v1.51.1-noble`): UI-v2 light/dark + legacy across
  desktop/tablet + mobile no-regression, all network mocked, no personal data,
  committed baselines, fails on material drift.
- No backend/API/DB/RBAC/migration change; no breadcrumb; no `PageHeader`
  restyle; no mobile-nav redesign (PR-UI8); no production activation.

## Dashboard safety posture (PR-UI5)

PR-UI5 restyles the authenticated **tenant staff Dashboard** (`/dashboard`)
under UI-v2 (Option B light / Option C dark) but **still ships OFF** — it rides
the PR-UI2 engine and adds no flag, tenant targeting, or activation. Full detail:
`UI-DASHBOARD.md`.

- **`.ui-v2`-scoped only.** Every rule hangs off inert page-local `db-*` hooks
  under `.ui-v2` in `globals.css`; a test parses the CSS and proves **no** `db-`
  rule escapes `.ui-v2` scope. Off-flag / super-admin / portal render unchanged.
- **No shared-component edits.** `PageHeader` gets a page-local accent **wrapper**
  (`.ui-v2 .db-header::before`) — the component is untouched; `Badge`,
  `EmptyState`, `ErrorNote`, `Spinner` recolour via the token cascade with zero
  edits. `StatCard`/`Panel`/`FinanceCell` are page-local to the Dashboard.
- **Glass only on the snapshot + needs-attention band (dark).** Stat/KPI cards,
  finance cells, announcements, quick actions and every data-heavy surface stay
  **solid**; the frosted band has a `prefers-reduced-transparency` solid fallback
  and is forced solid on print. A test proves glass (blur) is `.ui-v2.dark`-only.
- **Gold** is a small **pinned-announcement** accent only (`--c-gold`), never a
  business-status colour; success/warn/danger keep their semantic tokens.
- **`upcomingEvents`** stays unrendered (no widget/placeholder; no API change).
- **Deterministic Playwright Dashboard visual-regression** in CI (pinned
  `mcr.microsoft.com/playwright:v1.51.1-noble`): School-admin / College-admin /
  fees-less × desktop/tablet/mobile × UI-v2 light + dark + legacy = **27**
  baselines, all network mocked, no personal data, fails on material drift. The
  fees-less fixture proves finance is **absent** (`finance: null`), no ₹ leaks,
  and the layout closes without a broken gap.
- No backend/API/DB/RBAC/migration change; no KPI/calculation change; no new
  KPI/chart/widget/alert/quick-action; no shell/nav change; no production
  activation.

## Students safety posture (PR-UI6)

PR-UI6 restyles the authenticated **tenant staff Students** page (`/students`)
under UI-v2 (Option B: list + page-local Add/Edit modal) but **still ships OFF** —
it rides the PR-UI2 engine and adds no flag, tenant targeting, or activation. Full
detail: `UI-STUDENTS.md`.

- **`.ui-v2`-scoped, page-local `st-*` hooks only.** A test parses the CSS and
  proves **no** `st-` rule escapes `.ui-v2`, uses **no glass** (`backdrop-filter`)
  and **no gold** (`--c-gold`). Off-flag / super-admin / portal render unchanged.
- **Fully solid** in both themes (owner decision): table, toolbar, modal, form and
  every data surface stay solid for dense-data readability. The inline table is
  page-local; the shared `ui.tsx` primitives and the five shared modal components
  recolour via the token cascade with **no edits**.
- **No behaviour change.** APIs/query params, search/sort/pagination, RBAC,
  tenant isolation, teacher row-scope, terminology and Add/Edit/Delete/Import/
  Promote all preserved. `ENFORCE_TEACHER_SCOPE` untouched. `usePermissions` not
  added — server-side authorization stays authoritative.
- **Eligible-only a11y** (gated on `useSkinStore().active`): `th scope`, `sr-only`
  caption, row-action + search `aria-label`; **off-flag markup byte-identical**.
  Modal focus containment/restoration provided by the unchanged shared `Modal`.
- **Deterministic, privacy-safe Playwright visual-regression** in CI (pinned
  `mcr.microsoft.com/playwright:v1.51.1-noble`): **33** baselines — main
  {school-admin, college-admin, school-empty} × {light, dark, legacy} × 3
  viewports = 27, plus Add-modal (desktop) {school, college} × {light, dark,
  legacy} = 6. Synthetic data only; no real student PII in any artifact.
- **Deferred (separate scope):** improved client-side control visibility
  (hide/disable unauthorized actions) — a behaviour change, not in PR-UI6.

## Manual Fees safety posture (PR-UI7)

PR-UI7 adopts the authenticated **Manual Fees** page (`/fees`, list + three
page-local financial modals) into UI-v2 but **still ships OFF** — it rides the
PR-UI2 engine and adds no flag, tenant targeting, or activation. Full detail:
`UI-FEES.md`. GoCampus stays **offline/manual fees only** — no payment gateway,
online/partial payment, refund, settlement, GST or accounting change.

- **`.ui-v2`-scoped, page-local `fe-*` hooks only.** A test proves **no** `fe-`
  rule escapes `.ui-v2`, uses **no glass** (`backdrop-filter`) and **no gold**
  (`--c-gold`). Off-flag / super-admin / portal render unchanged.
- **Fully solid** in both themes (owner decision): invoice table, adjustment
  sub-tables, summary/breakdown cards, forms and modals stay solid for financial
  readability. The four tables are page-local; shared `Card`/`Modal`/primitives
  recolour via the token cascade — **no shared-component edit** (proven).
- **No behaviour change.** APIs/query params, calculations, monetary values,
  status/adjustment flows, tenant/academic-year scoping, RBAC and the **existing**
  client gating all preserved. `usePermissions` visibility unchanged.
- **Receipt/PDF/print untouched** — server-generated receipt PDF and the `@media
  print` forced-light block are not edited; a test asserts the print block has no
  `.fe-`.
- **Eligible-only a11y** (gated on `useSkinStore().active`): `th scope` + `sr-only`
  captions on the invoice/fines/discounts/payments tables + action/filter
  `aria-label`s; **off-flag markup byte-identical**.
- **Deterministic, privacy-safe Playwright visual-regression** in CI (pinned
  container): **39** baselines — main {school-admin, college-admin, empty} ×
  {light, dark, legacy} × 3 viewports = 27, plus Add-modal desktop {Payments
  full-perm, Payments RBAC-restricted, New-invoice, Record-payment} × {light,
  dark, legacy} = 12. Synthetic data only; `paidAt` masked; no financial PII in
  any artifact.
- **Deferred (separate scope):** client-side control visibility for
  New-invoice/Record-payment; `fees/setup/*` + `fees/refunds` adoption.

## Dark-override baseline

| Surface | `dark:` overrides | PR-UI1 action |
|---------|-------------------|---------------|
| Shared primitives (ui/charts/toast/icons) | **1** (`ErrorNote`) | removed → **0** |
| Tenant + super-admin pages | **238 across 92 files** | untouched (out of scope) |

The 238 page-level overrides are recorded here and deliberately **not** removed
globally — they migrate as pages adopt the tokens in later PRs.

## Permission inventory (read-only; unchanged by PR-UI1)

Confirmed RBAC keys for the restricted pilot components (no RBAC change made):

| Component | Permission key(s) |
|-----------|-------------------|
| Fee fines — waive | `fee_fines:waive` (enforced on `POST /fees/applied-fines/:id/waive`; migration `0033`) |
| Payroll widget | `payroll:read` (view) · `payroll:update` · `payroll:manage` · `payroll:payslip` |
| Disciplinary tab | `disciplinary:read` (view) · `disciplinary:portal_read` (parent) · `create/update/action/close/delete/reports` |

## Fonts

Self-hosted `@font-face` (Manrope + Noto Sans Tamil, OFL-1.1) in `globals.css`;
binaries + license documented in `frontend/public/fonts/README.md` and `OFL.txt`.
No external font host. Binaries are the only drop-in step before activation (dormant,
so zero production effect until then).

## Evidence location

- **Token/identity/contrast/dormancy tests:** `frontend/src/components/ui-v2-tokens.test.ts`
- **Guard rules (glass allow-list + dormancy):** `frontend/scripts/design-guard.mjs`,
  asserted in `frontend/src/design-guard.test.ts`
- **Design system:** `UI-TOKEN-REFERENCE.md`, `UI-COMPONENT-CATALOGUE.md`,
  `UI-CONTRIBUTION-RULES.md` (this folder)
- **CI:** typecheck · unit/token/guard tests · frontend production build (see PR checks)
