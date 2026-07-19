# UI Modernization Rollout Tracker

Single source of truth for the phased GoCampus UI/UX modernization.

## Status

| PR | Scope | State |
|----|-------|-------|
| **PR-UI1** | Design tokens + shared foundations (dormant `.ui-v2`, self-hosted fonts, Tailwind mapping, 4 primitives, guard, tests, docs) | **This PR** |
| PR-UI2+ | Theme engine, runtime switch, page adoption, StatCard/Table/Tabs consolidation, mobile nav | Deferred |

## Dormancy / safety posture (PR-UI1)

- `.ui-v2` is **never applied** in the DOM — enforced by the guard's `ui-v2-dormant`
  rule. Off-flag rendering is byte-identical (light + dark).
- No backend/API/DB/migration/RBAC/business-logic change. No `layout.tsx` change.
  No production activation.
- Reserved flag `NEXT_PUBLIC_UI_V2` (default off), not wired to any toggle.

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
