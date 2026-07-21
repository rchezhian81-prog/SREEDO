# UI-v2 Tenant Staff Dashboard (PR-UI5)

Restyles the authenticated **tenant staff Dashboard** (`/dashboard`) under UI-v2
— Option B (light) *Modern Soft Premium* and Option C (dark) *Intelligent Glass*
— riding the PR-UI2 theme engine and the PR-UI3 shell. It **ships OFF**: nothing
renders differently until **both** UI-v2 gates are true (build master
`NEXT_PUBLIC_UI_V2==="true"` **and** the caller's audited tenant `uiV2Enabled`).
Off-flag — every super-admin and portal session, and all off-flag tenants — the
Dashboard is byte/pixel-identical to legacy.

## What changes (styling only)

The Dashboard is a single self-contained page on **one** API — `GET
/dashboard/summary` (tenant-scoped, staff-only, RBAC-filtered, 30 s cached). No
KPI, calculation, endpoint, permission, terminology, quick-action destination, or
data-freshness behaviour changes. `upcomingEvents` stays unrendered (it is in the
payload but has never been surfaced; PR-UI5 does not add it).

| Surface (page-local hook) | Light — Option B | Dark — Option C |
|---|---|---|
| Header accent (`db-header`) | violet→indigo accent band above the shared PageHeader (pseudo-element on the wrapper; component untouched) | same, solid |
| Needs-attention band (`db-attention`) | premium solid panel | **glass** (restrained blur, readable, reduced-transparency + print fallbacks) |
| Institution snapshot (`db-snapshot`) | premium solid card | **glass** (same rules) |
| KPI / stat cards (`db-stat`) | solid premium, soft elevation + hover lift | **solid** |
| Panels: fees / announcements (`db-panel`) | solid premium | **solid** |
| Finance cells (`db-finance-cell`) | solid; semantic value colours kept | **solid** |
| Pinned announcement (`db-ann--pinned`) | restrained **gold** left-accent | restrained gold left-accent |
| Loading / empty / error | token-recoloured, solid | solid |

- **Glass is limited to the two non-data bands** (snapshot + needs-attention) and
  **only in dark**. Everything data-heavy stays solid for readability. The glass
  band falls back to a solid surface under `prefers-reduced-transparency: reduce`
  and is forced solid on print.
- **Gold** (`--c-gold`) is a small pinned-announcement accent **only** — never a
  business-status colour. Positive/success stays semantic green; warning/overdue/
  error keep their meanings. No pinned announcement ⇒ no gold.
- **Manrope + Noto Sans Tamil** apply under `.ui-v2` (from PR-UI1); money figures
  use tabular lining numerals via `data-numeric`.

## Isolation & dormancy

- **`.ui-v2`-scoped, page-local hooks.** Every rule is `.ui-v2 .db-*` in
  `globals.css`; the `db-*` hook classes live only on the Dashboard page. A test
  parses the CSS and asserts **no** `db-` rule escapes `.ui-v2`, that glass (blur)
  is `.ui-v2.dark`-only, and that gold is confined to `.db-ann--pinned`.
- **No shared-component edits.** The shared `PageHeader` is wrapped, never
  restyled; `Badge` / `EmptyState` / `ErrorNote` / `Spinner` recolour purely via
  the `.ui-v2` token cascade. `StatCard` / `Panel` / `FinanceCell` are defined
  inline in the Dashboard page, so restyling them cannot affect other pages.
- **Dormant by construction.** The skin engine applies `.ui-v2` only in
  `(dashboard)/layout.tsx`, and only for an eligible authenticated staff session;
  the design-guard `ui-v2-dormant` rule still passes (no `.ui-v2`/`UI_V2_CLASS`
  applied in `src/` outside the sanctioned engine files).

## Tests

- **jsdom** (`dashboard-ui-v2.test.tsx`): KPI/data parity (School + College values
  render exactly, correct terminology), RBAC (fees-less summary has
  `finance: null` → "no access" empty state, **no ₹**, requests only
  `/dashboard/summary` + `/auth/permissions`, never `/fees`), `upcomingEvents`
  unrendered, and the CSS frozen-surface / glass-scoping / gold-scoping proofs.
- **Playwright** (`e2e/visual/dashboard.visual.spec.ts`): 27 deterministic
  baselines — School-admin / College-admin / fees-less × desktop 1440×900 /
  tablet 820×1180 / mobile 390×844 × UI-v2 light + dark + legacy. Content area
  (`#main-content`) only; the shell is covered by the PR-UI3 suite. All network
  mocked, synthetic data, animations off, fonts + skin-class awaited, dates
  masked. Fails on material drift.

## Files

- `frontend/src/app/(dashboard)/dashboard/page.tsx` — inert `db-*` hooks (no logic
  change).
- `frontend/src/app/globals.css` — the `.ui-v2 .db-*` Dashboard section (+ print
  fallback).
- `frontend/e2e/visual/dashboard.visual.spec.ts` + `dashboard-fixtures.ts` +
  committed baselines.
- `frontend/src/app/(dashboard)/dashboard/dashboard-ui-v2.test.tsx`.

## Running the visual suite

```
cd frontend
npm run test:visual            # compare against committed baselines
```
Regenerate baselines only on a deliberate, reviewed Dashboard change, in the
pinned image so they match CI:
```
docker run --rm --ipc=host -v "$PWD":/work -w /work -e CI=1 \
  mcr.microsoft.com/playwright:v1.51.1-noble \
  sh -lc "npm ci && npm run test:visual:update"
git add frontend/e2e/visual/**/*.png   # review the diff before committing
```
