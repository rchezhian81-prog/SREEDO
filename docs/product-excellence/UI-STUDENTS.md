# UI-v2 Tenant Staff Students (PR-UI6)

Restyles the authenticated **tenant staff Students** page (`/students`) under
UI-v2 — Option B (the list page **plus its page-local Add/Edit modal**) — riding
the PR-UI2 engine, the PR-UI3 shell and the PR-UI5 Dashboard conventions. It
**ships OFF**: the premium look renders only when **both** UI-v2 gates are true
(build master `NEXT_PUBLIC_UI_V2==="true"` **and** the caller's audited tenant
`uiV2Enabled`). Off-flag — every super-admin and portal session, and all off-flag
tenants — the page is **byte/pixel-identical** to legacy.

## Boundary (Option B)

One page: `frontend/src/app/(dashboard)/students/page.tsx`. **No child routes** —
Add/Edit/View are page-local modals. Restyle targets the page-local **inline
table**, search, action toolbar, row actions, pagination, empty/loading states,
and the page-local **Add/Edit form container**. The shared `ui.tsx` primitives
and the five shared modal components (`ImportCsvModal`, `CertificateModal`,
`GuardiansModal`, `StudentPerformanceModal`, `PromoteStudentsModal`) recolour via
the `.ui-v2` token cascade with **no edits**.

## What changes (styling + eligible-only a11y — no behaviour change)

- **`st-*` page-local hooks** drive `.ui-v2 .st-*` rules in `globals.css`.
  - `st-table`: premium solid surface, refined `surface-2` header, calm row hover,
    restrained elevation.
  - `st-actions`: restrained emphasis on row-action links; **Delete keeps its
    semantic danger red**.
- **Fully solid, no glass, no gold** (owner decisions): the table, toolbar, modal,
  form and every data surface stay solid in both themes for dense-data
  readability. Gold is not used on this page.
- **APIs, query params, search/sort/pagination, RBAC, tenant isolation, teacher
  row-scope, terminology, Add/Edit/Delete/Import/Promote behaviour and error
  handling are unchanged.** `usePermissions` is not added — server-side
  authorization stays authoritative (client control visibility unchanged; see the
  deferred item below).

## Accessibility (eligible-UI-v2 sessions only; legacy identity preserved)

Gated on `useSkinStore().active` so off-flag markup is byte-identical:

- `th scope="col"` on every column header.
- An `sr-only` `<caption>` ("Students list").
- `aria-label` on each row-action button (e.g. `Edit {name}`, `Delete {name}`).
- `aria-label` on the search input ("Search students").
- **Modal focus containment + restoration + Escape** are already provided by the
  shared `Modal` (unchanged); form labels/errors come from the shared `Field`
  (unchanged).

## Privacy

All visual/jsdom fixtures are **synthetic** — obviously-fake names, admission
numbers and phones; **no** production API/DB access and **no** real student
names, photos, contacts or identifiers in screenshots, logs or CI artifacts. No
unstable/locale-generated value is rendered in the table (nothing to mask).

## Isolation & dormancy

- Every rule is `.ui-v2 .st-*`; a test parses `globals.css` and proves **no
  `st-` rule escapes `.ui-v2`**, uses **no glass** (`backdrop-filter`), and **no
  gold** (`--c-gold`). Off-flag / super-admin / portal render unchanged.
- The design-guard `ui-v2-dormant` rule stays green (the page reads
  `useSkinStore().active` but never applies `.ui-v2`/`UI_V2_CLASS`).

## Tests

- **jsdom** (`students-ui-v2.test.tsx`): data/terminology parity (school +
  college), request/action parity (only `/students` + placement reads; Add empty
  / Edit prefilled), eligible-only a11y (off-flag adds nothing; on-flag adds
  scope/caption/aria-labels), and the CSS frozen-surface / no-glass / no-gold
  proofs.
- **Playwright** (`e2e/visual/students.visual.spec.ts`): **33** deterministic
  baselines — main page {School-admin, College-admin, School-empty} × {UI-v2
  light, UI-v2 dark, legacy} × {desktop 1440×900, tablet 820×1180, mobile 390×844}
  = 27, plus Add-modal (desktop) {School, College} × {UI-v2 light, UI-v2 dark,
  legacy} = 6. Generated in the pinned `mcr.microsoft.com/playwright:v1.51.1-noble`
  container; all network mocked; animations off; fails on material drift.

## Files

- `frontend/src/app/(dashboard)/students/page.tsx` — inert `st-*` hooks +
  skin-active-gated a11y (no logic/API/permission change).
- `frontend/src/app/globals.css` — the `.ui-v2 .st-*` Students section (solid; no
  glass/gold rule).
- `frontend/e2e/visual/students.visual.spec.ts` + `students-fixtures.ts` + committed baselines.
- `frontend/src/app/(dashboard)/students/students-ui-v2.test.tsx`.

## Deferred (separate scope)

Improved **client-side control visibility** (hiding/disabling Add/Edit/Delete/
Import/Promote for callers who lack the permission — currently server-403-enforced
only) is a **behaviour change** and is **out of scope** for PR-UI6. It needs its
own scope gate, RBAC-visibility tests and owner approval.
