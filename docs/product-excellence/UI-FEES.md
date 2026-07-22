# UI-v2 Manual Fees (PR-UI7)

Adopts the authenticated **Manual Fees** page (`/fees`) into UI-v2 — Option B (the
list/index page **plus its three page-local financial modals**) — riding the
PR-UI2 engine, PR-UI3 shell and PR-UI5/UI6 conventions. It **ships OFF**: the
premium look renders only when **both** UI-v2 gates are true (build master
`NEXT_PUBLIC_UI_V2==="true"` **and** the caller's audited tenant `uiV2Enabled`).
Off-flag — every super-admin and portal session, and all off-flag tenants — the
page is **byte/pixel-identical** to legacy.

GoCampus remains **offline/manual fees only**. PR-UI7 is styling + eligible-only
a11y: **no** payment gateway, online/partial payment, refund, settlement,
reconciliation, GST, accounting, calculation, payment-state or business-logic
change.

## Boundary (Option B)

One page: `frontend/src/app/(dashboard)/fees/page.tsx` and its page-local content:
- **List/index:** 3 summary cards (Total invoiced / Collected / Outstanding),
  status filter, inline invoice table, row actions (View payments, Record
  payment), "New invoice".
- **Modal 1 — Payments/Adjustments:** breakdown 4-card grid + inline fines table
  (+Waive) + inline discounts table (+Approve) + Apply-fine + Apply-discount
  controls + inline payments table (+Receipt).
- **Modal 2 — New invoice** · **Modal 3 — Record payment.**

`fees/setup/*`, `fees/refunds`, SaaS billing, portals and receipts/PDF are **out
of scope**.

## What changes (styling + eligible-only a11y — no behaviour change)

- **Page-local `fe-*` hooks** drive `.ui-v2 .fe-*` rules: `fe-table` (invoice
  table) and `fe-subtable` (fines/discounts/payments modal tables) get a premium
  solid surface, refined `surface-2` header and calm hover; `fe-actions` gives
  restrained emphasis to row-action links. `fe-summary`/`fe-filter`/`fe-breakdown`
  are scoping anchors (recolour via the cascade); `fe-paid-date` is a mask target
  for visual tests.
- **Fully solid, no glass, no gold** (owner decisions): every financial surface —
  invoice table, adjustment sub-tables, summary/breakdown cards, forms, modals —
  stays solid in both themes. **Collected stays semantic green, Outstanding/
  overdue stays semantic red.** No gold on this page.
- The shared `Card`/`Modal`/primitives recolour via the token cascade with **zero
  edits** — no shared-component edit is required (proven: all four tables are
  inline/page-local).

## Preserved exactly

APIs/query params, `/fees/summary` + `/fees/invoices?status&limit`; status filter;
New-invoice validation/submit (`POST /fees/invoices`, `fees:manage`);
Record-payment validation/submit + Outstanding math (`amountDue − amountPaid`) +
method enum; View-payments (breakdown + fines + discounts + payments); Apply-fine/
Waive/Apply-discount/Approve flows and their **existing** `can()` gating; Receipt
download; currency `toLocaleString()`; badge tones; error handling; tenant +
academic-year + row scoping; RBAC keys; audit. **`usePermissions` control
visibility is unchanged** — server-side authorization stays authoritative.

## Accessibility (eligible UI-v2 sessions only; legacy identity preserved)

Gated on `useSkinStore().active` (off-flag byte-identical): `th scope="col"` +
`sr-only` `<caption>` on the invoice, fines, discounts and payments tables;
descriptive `aria-label`s on row actions (View payments / Record payment / Waive /
Approve / Receipt) and the status filter. Modal focus-trap/restore + `role=dialog`
and form label/error association come from the **unchanged** shared `Modal`/
`Field`.

## Receipt / print protection

The receipt is a **server-generated PDF** (`GET /fee-receipts/:paymentId/download`,
backend) — no backend file is touched, and `downloadPdf()`/the Receipt button are
unchanged. The in-page `@media print` block (already forces `.ui-v2` light) is
**not edited** and contains **no** `fe-` rule → printed output stays forced-light
and byte/functionally identical. A test asserts the print block has no `.fe-`.

## Privacy

All visual/jsdom fixtures are **synthetic** — fake invoice numbers, student names,
amounts and references; **no** production API/DB and **no** real financial/PII data
in screenshots, logs or artifacts. The locale/tz `paidAt` cell (`.fe-paid-date`)
is **masked** in every screenshot.

## Isolation & dormancy

- Every rule is `.ui-v2 .fe-*`; a test proves **no `fe-` rule escapes `.ui-v2`**,
  uses **no glass** (`backdrop-filter`) and **no gold** (`--c-gold`).
- Design-guard `ui-v2-dormant` stays green (the page reads `useSkinStore().active`,
  never applies `.ui-v2`/`UI_V2_CLASS`); the swept-`fees` lock stays clean (`fe-*`
  are semantic classnames, no raw palette/hex/emoji).

## Tests

- **jsdom** (`fees-ui-v2.test.tsx`): data parity (school + college); request parity
  (only fees + `/students` + permissions); **RBAC visibility** (restricted hides
  Apply-fine/Apply-discount + Waive/Approve, keeps New-invoice/Record-payment);
  Outstanding math; modal opens; eligible-only a11y; CSS frozen-surface /
  no-glass / no-gold / print-block-untouched proofs.
- **Playwright** (`e2e/visual/fees.visual.spec.ts`): **39** deterministic baselines
  — main {school-admin, college-admin, empty} × {light, dark, legacy} × 3
  viewports = 27, plus Add-modal desktop {Payments full-perm, Payments
  RBAC-restricted, New-invoice, Record-payment} × {light, dark, legacy} = 12 —
  generated in the pinned `mcr.microsoft.com/playwright:v1.51.1-noble` container,
  `paidAt` masked, synthetic data only.

## Files

- `frontend/src/app/(dashboard)/fees/page.tsx` — inert `fe-*` hooks + skin-active
  a11y (no logic change).
- `frontend/src/app/globals.css` — the `.ui-v2 .fe-*` Fees section (solid; no
  glass/gold; no `@media print` change).
- `frontend/e2e/visual/fees.visual.spec.ts` + `fees-fixtures.ts` + committed baselines.
- `frontend/src/app/(dashboard)/fees/fees-ui-v2.test.tsx`.

## Deferred (separate scope)

Client-side control visibility for New-invoice/Record-payment (server-403 today);
`fees/setup/*` + `fees/refunds` UI-v2 adoption; shared StatCard/Table/Tabs
consolidation. PR-UI4 (Authentication) remains DEFERRED.
