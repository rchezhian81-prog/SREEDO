# SaaS Invoicing — Billing Phase B2 / B2.2 (gateway-free)

Lets the operator **invoice institutions** for their subscription and record
**offline** payment (bank transfer / cheque / UPI reference), with a **PDF** and
a **super-admin UI**. Phase B2 of `docs/SAAS_BILLING_ROADMAP.md`; **B2.2** adds
due dates/overdue, full draft editing, duplicate/resend, and a paginated list
with summary cards. **No payment gateway, no auto-charging, additive migrations
only, super-admin only.**

> Separate from student fee collection (`modules/fees`, `modules/onlinepayments`)
> and from B1 subscription lifecycle (`docs/modules/subscription-lifecycle.md`).

## Lifecycle
```
draft ──issue──▶ issued ──mark-paid──▶ paid
  │                  │
  └──────void───────┴── void        (a paid invoice cannot be voided)
```
- **draft** — fully editable; not numbered. Header (`PATCH /invoices/:id`), add a
  line (`POST …/lines`), edit a line (`PATCH …/lines/:lineId`), remove a line
  (`DELETE …/lines/:lineId`), or delete the whole draft (`DELETE /invoices/:id`).
- **issue** — assigns the next **financial-year-segmented** number, freezes
  totals, sets `issued_at`, computes the **due date** (below), and sends a
  **best-effort** email. Issued invoices are immutable.
- **mark-paid** — records OFFLINE payment (`payment_method`, `payment_reference`,
  `paid_at`). Single full payment; manual super-admin action; no gateway.
- **void** — for a draft or issued invoice; a **paid** invoice cannot be voided.
- **duplicate** — clones any invoice (header + lines) into a fresh **draft**
  (number/status/dates/payment cleared) for the next billing period.

## Invoice numbering (D1, updated)
Format **`SINV-FY2026-27-001000`** = prefix + FY label + zero-padded sequence
(prefix / FY-start month / padding all configurable in settings). Assigned
**only on issue** (drafts never consume a number), **unique and immutable**.

Since migration `0076` the sequence is a **single settable, continuous running
counter** (`invoice_settings.next_invoice_number`), not a per-FY reset: the
operator sets the starting/next number once (Settings → **Next invoice number**)
and issuance auto-continues from there across financial years (the FY label in
the string still reflects the issue date). Each issue atomically takes the next
value under a row lock on the singleton settings row → unique, gap-free,
concurrency-safe. The number can only be set **at/above the highest already-issued
number** (enforced) so a switch never collides. (`0076` seeds the counter just
above any existing number; the legacy per-FY `saas_invoice_counters` table is now
inert.)

## Due dates & overdue (B2.2)
- Optional **`payment_terms_days`** (Net-N) and/or an explicit **`due_date`** on a
  draft. On **issue**, `due_date` is set to the explicit date if given, else
  `issue_date + payment_terms_days` (if terms set), else left empty.
- **Overdue is computed at read time** — `status = 'issued' AND due_date < today`
  — never stored, so it's always current and needs no background sweep. Every
  invoice payload carries a boolean **`isOverdue`**.

## Tax / billing (D2)
Flat **`tax_percent`** (default `0`) → `tax_amount`, `total`. Optional, printed on
the PDF: **`gstin`**, **`billing_name`**, **`billing_address`**, **`tax_notes`**.
Full CGST/SGST/IGST split is a later **B2.1** (after accountant review).

## PDF (D3, upgraded)
`GET /platform/invoices/:id/pdf` renders a self-contained A4 PDF (pdfkit, via the
shared `utils/pdf.renderPdf`): a **company "from" block** (+ optional logo) from
`SAAS_COMPANY_*`, the bill-to (institution / billing name+address, GSTIN), issue
**and due** dates, period, line items, subtotal, tax % + amount, total, payment
details (method + reference when paid), notes, and a faint diagonal **status
watermark** (DRAFT / PAID / VOID / OVERDUE).

## Email on issue / resend (D5)
On issue, a **best-effort** summary email is sent to the institution's active
admins **only if SMTP is configured**; the **issue still succeeds** if SMTP is
missing or sending fails (fully guarded). `POST /invoices/:id/resend` re-sends it
for an **issued or paid** invoice and returns `{ recipients }`.

## Currency (D6) & package link (D7)
Per-invoice `currency` (default `INR`); the UI formats money via
`Intl.NumberFormat` (`frontend/src/lib/format.ts`). Optional `package_id`
(`ON DELETE SET NULL`) — never required; line items remain the source of truth.

## Money (D8)
All amounts `NUMERIC(12,2)`; line/subtotal/tax/total computed in **SQL** to avoid
JS float drift.

## Schema — migrations (additive, safe)
- **`0073_saas_invoices.sql`** — `saas_invoices`, `saas_invoice_lines`,
  `saas_invoice_counters` (per-FY).
- **`0074_saas_invoice_due_dates.sql`** — adds `payment_terms_days` (checked ≥ 0)
  and `due_date` to `saas_invoices` + a partial index on `due_date` for issued
  rows. New columns/index only; no existing column changed, no data deleted.
- **`0075_saas_invoice_settings_audit_gst.sql`** (P0) — `invoice_settings`
  (singleton, seeded) + `invoice_emails` (delivery log); adds audit metadata
  (`issued_by`/`recorded_by`/`voided_by`/`voided_at`/`void_reason`), `round_off`,
  and GST-readiness fields (`sac_code`, `place_of_supply`, `reverse_charge`,
  supplier/recipient `state`/`state_code`) to `saas_invoices`, and `sac_code` to
  lines. Money-action **audit reuses `platform_audit_log`** (target_type
  `saas_invoice`) — no new audit table.

## Endpoints (super-admin)
| Method | Path | Permission |
|---|---|---|
| POST | `/platform/institutions/:id/invoices` | `platform:manage_subscriptions` |
| GET | `/platform/institutions/:id/invoices` (`?status=`) | `platform:read` |
| GET | `/platform/invoices` (paged: `status`,`institutionId`,`overdue`,`from`,`to`,`q`,`page`,`pageSize`,`sort`,`order`) | `platform:read` |
| GET | `/platform/invoices/summary` | `platform:read` |
| GET | `/platform/invoices/:id` | `platform:read` |
| GET | `/platform/invoices/:id/pdf` | `platform:read` |
| POST | `/platform/invoices/:id/lines` | `platform:manage_subscriptions` |
| PATCH | `/platform/invoices/:id/lines/:lineId` | `platform:manage_subscriptions` |
| DELETE | `/platform/invoices/:id/lines/:lineId` | `platform:manage_subscriptions` |
| PATCH | `/platform/invoices/:id` (edit draft header) | `platform:manage_subscriptions` |
| DELETE | `/platform/invoices/:id` (delete draft) | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/issue` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/mark-paid` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/void` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/duplicate` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/resend` | `platform:manage_subscriptions` |
| GET | `/platform/invoices/:id/audit` | `platform:read` |
| GET | `/platform/invoice-settings` | `platform:read` |
| PATCH | `/platform/invoice-settings` | `platform:manage_subscriptions` |

`POST /platform/invoices/:id/void` now requires a JSON body `{ reason }`.

`GET /platform/invoices` returns `{ rows, total, page, pageSize }`.
`GET /platform/invoices/summary` returns counts by status plus
`outstandingAmount`, `paidAmount`, `overdueCount`, `overdueAmount`.

## UI (D4) — super-admin → Invoices
- **List** (`/super-admin/invoices`): **summary cards** (outstanding / overdue /
  paid / drafts), filters (status, institution, date range, overdue-only,
  debounced search), **sortable** columns, **server-side pagination**, due-date +
  overdue badges, and a per-row **PDF** link. "New invoice" modal (institution,
  package, currency, tax %, payment terms, due date, period, billing/GSTIN/
  address, line items, notes).
- **Detail** (`/super-admin/invoices/[id]`): toolbar (Download PDF, Duplicate,
  Resend on issued/paid, Delete on draft) + status/due/overdue summary; line
  items with **inline editing** + remove on drafts; draft: edit header (incl.
  payment terms / due date / SAC / place of supply / reverse charge / recipient
  state) / add line / **issue** / void; issued: **mark paid** / void. Void opens
  a **reason-required** modal; delete/remove-line use a confirm dialog. The page
  also shows the **email-delivery log** and the **audit timeline**. Money is
  formatted with `Intl.NumberFormat`.
- **Settings** (`/super-admin/invoices/settings`): supplier profile, numbering,
  billing defaults, bank/UPI and PDF presentation.

## Audit, settings, email log & GST readiness (P0)
- **Audit** — every money action (create, draft edit, line add/edit/remove,
  issue, mark-paid, void, delete, duplicate, resend, PDF download, settings
  change) writes a `platform_audit_log` row (`target_type = 'saas_invoice'`,
  actor + IP + user-agent in `detail`). `GET /platform/invoices/:id/audit`
  returns the timeline; it's shown on the detail page.
- **Invoice settings** (`/platform/invoice-settings`, singleton) — supplier
  profile (legal/trade name, GSTIN, PAN, state/code, email, phone), numbering
  (prefix, FY start month, padding), billing defaults (currency, tax %, SAC,
  due days), bank/UPI, and PDF presentation (footer, terms, signatory, logo).
  **Numbering and new-draft defaults read from settings** (env is the fallback).
  Edited on the super-admin **Settings** page.
- **Email delivery log** (`invoice_emails`) — each issue/resend attempt records
  recipient, template, status (`sent`/`failed`/`skipped`) and error; shown on the
  detail page. Issue still never fails on email problems.
- **Void reason** — voiding requires a reason; `voided_by`/`voided_at`/
  `void_reason` are stored and surfaced. A paid invoice still can't be voided.
- **GST readiness** — `sac_code` (invoice + line), `place_of_supply`,
  `reverse_charge`, and supplier/recipient `state`/`state_code` are stored and
  printed. Supplier state is snapshotted from settings on issue. Tax stays flat
  `tax_percent` (full CGST/SGST/IGST engine deferred to B2.1, post-CA review).
- **PDF** also gains the supplier block, SAC column, place of supply, reverse
  charge, **amount in words**, bank/UPI, signatory and page-numbered footer.

## Reports, exports & advanced search (P1)
- **Advanced search** — the list (`GET /platform/invoices`) and exports accept
  backend-supported filters: `status`, `institutionId`, `overdue`, `from`/`to`
  (created), `dueFrom`/`dueTo`, `amountMin`/`amountMax`, `sacCode`, `gstin`,
  `placeOfSupply`, `recipientState`, `reverseCharge`, `q` — all parameterized in
  one shared `buildInvoiceFilters()` (no string interpolation of values).
- **Reports** — `GET /platform/invoices/reports?type=…` (+ `from`/`to`/
  `institutionId`): `all`, `paid`, `unpaid`, `overdue`, `draft`, `void`,
  `by-institution`, `by-month`, `revenue`, `tax` — each returns `{ columns, rows,
  totals }` (count / subtotal / tax / grand total, plus paid/issued/void or
  collected/outstanding as applicable). Overdue = issued + past due; the tax
  summary covers issued+paid only (void/draft excluded).
- **Exports** — `GET /platform/invoices/export` (filtered list) and the reports
  endpoint with `format=csv|xlsx` stream **CSV** (RFC-4180 + UTF-8 BOM) or
  **XLSX** built natively via `utils/spreadsheet.ts` (zlib zip + OpenXML; **no
  new dependency**). Exports honor the active filters and are audited
  (`invoice.exported` / `invoice.report_exported`). UI: a **Reports** page
  (`/super-admin/invoices/reports`) and an advanced-filter section + export
  buttons on the list.
- **Out of scope (by product decision):** partial payments, discounts, payment
  gateway, full CGST/SGST/IGST engine, e-invoice/IRN/QR, and credit/debit notes
  (credit/debit = P2).

## Configuration (env)
| Var | Default | Meaning |
|---|---|---|
| `SAAS_INVOICE_PREFIX` | `SINV-` | invoice number prefix |
| `SAAS_INVOICE_CURRENCY` | `INR` | default currency for new invoices |
| `SAAS_COMPANY_NAME` | `SRE EDU OS` | seller name on the PDF "from" block |
| `SAAS_COMPANY_ADDRESS` | — | seller address (optional) |
| `SAAS_COMPANY_EMAIL` | — | seller email (optional) |
| `SAAS_COMPANY_GSTIN` | — | seller GSTIN (optional) |
| `SAAS_COMPANY_LOGO_PATH` | — | absolute path to a logo image for the PDF (optional) |

Since P0, the **invoice settings** row supersedes these env vars for the PDF
supplier block and numbering; env remains the fallback when a setting is blank.

## Deployment notes
- Migrations auto-apply on boot (`runMigrations()` in `server.ts`).
- **No behaviour change on deploy** — invoicing is operator-initiated; no gateway
  is contacted. Email needs SMTP (degrades gracefully). Rebuild backend +
  frontend (`docker compose … up -d --build`).
- Super-admin only.

## Tests
`backend/tests/integration/invoices.int.test.ts` — draft + tax math, FY numbering
+ sequence, billing fields, PDF endpoint, offline mark-paid + reference, void
guards, **paged list** (empty/populated/filtered), edit header + edit/remove
**line** (recompute + 404 + guards), **delete draft** (+ issued guard),
**duplicate**, **resend** (issued/paid only), **due date on issue + overdue
flag**, **summary** aggregates, pagination + institution/search filters, tenant
scoping, and non-super-admin → 403. `invoices-p0.int.test.ts` covers settings →
numbering/defaults, void-reason, GST fields, the audit timeline, the email log,
and the richer PDF.

## Rollback
Additive only. Revert the PR to remove endpoints/UI. The tables/columns are inert
(no existing table references them); leave them in place if any invoice exists, or
drop the new columns/tables via an explicit, gated script only when empty. No
existing data is touched by any rollback.

## Not in B2 (follow-ups)
Full GST (CGST/SGST/IGST, HSN) = **B2.1** after accountant review · recurring /
gateway charging + dunning = **B4** (gated on credentials) · credit notes /
partial payments (single full payment is intentional for now).
