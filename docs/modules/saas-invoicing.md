# SaaS Invoicing — Billing Phase B2 (gateway-free)

Lets the operator **invoice institutions** for their subscription and record
**offline** payment (bank transfer / cheque / UPI reference), with a **PDF** and
a **super-admin UI**. Phase B2 of `docs/SAAS_BILLING_ROADMAP.md`. **No payment
gateway, no auto-charging, additive migration only, super-admin only.**

> Separate from student fee collection (`modules/fees`, `modules/onlinepayments`)
> and from B1 subscription lifecycle (`docs/modules/subscription-lifecycle.md`).

## Lifecycle
```
draft ──issue──▶ issued ──mark-paid──▶ paid
  │                  │
  └──────void───────┴── void        (a paid invoice cannot be voided)
```
- **draft** — editable; line items can be added; not numbered.
- **issue** — assigns the next **financial-year-segmented** number, freezes
  totals, sets `issued_at`, and sends a **best-effort** email (below).
- **mark-paid** — records OFFLINE payment (`payment_method`, `payment_reference`,
  `paid_at`). Manual super-admin action; no gateway.
- **void** — for a draft or issued invoice; a **paid** invoice cannot be voided.

## Invoice numbering (D1)
Format **`SINV-FY2026-27-000001`** = `SAAS_INVOICE_PREFIX` + FY label + 6-digit
sequence. Indian financial year (Apr–Mar): an invoice issued in Jun 2026 →
`FY2026-27`. Rules:
- Assigned **only on issue** — drafts never consume a number.
- **Unique and immutable** after issue (no update path).
- **Per-FY** counter (`saas_invoice_counters`, atomic `INSERT … ON CONFLICT … +1`),
  so each financial year has its own gap-free series.

## Tax / billing (D2)
Flat **`tax_percent`** (default `0`) → `tax_amount`, `total`. Optional, printed on
the PDF: **`gstin`**, **`billing_name`**, **`billing_address`**, **`tax_notes`**.
Full CGST/SGST/IGST split is a later **B2.1** (after accountant review).

## PDF (D3)
`GET /platform/invoices/:id/pdf` renders a self-contained A4 PDF (pdfkit, via the
shared `utils/pdf.renderPdf`): invoice number, institution + billing name/address,
GSTIN if present, line items, subtotal, tax % + amount, total, status, issue date,
paid date + method if paid, and notes.

## Email on issue (D5)
On issue, a **best-effort** summary email is sent to the institution's active
admins **only if SMTP is configured**. If SMTP is missing or sending fails, the
**issue still succeeds** (the notify step is fully guarded; `sendMail` is
fire-and-forget) — a warning is logged.

## Currency (D6) & package link (D7)
Per-invoice `currency` (default `INR`). Optional `package_id` link
(`ON DELETE SET NULL`) — never required; line items remain the source of truth.

## Money (D8)
All amounts `NUMERIC(12,2)`; line/subtotal/tax/total computed in **SQL** to avoid
JS float drift.

## Schema — migration `0073_saas_invoices.sql` (additive, safe)
`saas_invoices` (institution_id, optional package_id, `number` UNIQUE/nullable,
status CHECK `draft|issued|paid|void`, currency, period, subtotal/tax_percent/
tax_amount/total NUMERIC, gstin/billing_name/billing_address/tax_notes/notes,
issued_at, paid_at, payment_method, payment_reference, created_by, timestamps) ·
`saas_invoice_lines` · `saas_invoice_counters` (per-FY). New objects only; no
existing table changed; no data deleted.

## Endpoints (super-admin)
| Method | Path | Permission |
|---|---|---|
| POST | `/platform/institutions/:id/invoices` | `platform:manage_subscriptions` |
| GET | `/platform/institutions/:id/invoices` | `platform:read` |
| GET | `/platform/invoices` (`?status=`) | `platform:read` |
| GET | `/platform/invoices/:id` | `platform:read` |
| GET | `/platform/invoices/:id/pdf` | `platform:read` |
| POST | `/platform/invoices/:id/lines` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/issue` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/mark-paid` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/void` | `platform:manage_subscriptions` |

## UI (D4) — super-admin → Invoices
- **List** (`/super-admin/invoices`): all invoices, status filter, "New invoice"
  modal (institution, currency, tax %, optional billing/GSTIN/address, line items, notes).
- **Detail** (`/super-admin/invoices/[id]`): line items + totals + billing; status
  actions — draft: add line / **issue** / void; issued: **mark paid** / download
  PDF / void; paid|void: download PDF.

## Configuration (env)
| Var | Default | Meaning |
|---|---|---|
| `SAAS_INVOICE_PREFIX` | `SINV-` | invoice number prefix |
| `SAAS_INVOICE_CURRENCY` | `INR` | default currency for new invoices |

## Deployment notes
- Migration auto-applies on boot (`runMigrations()` in `server.ts`).
- **No behaviour change on deploy** — invoicing is operator-initiated; no gateway
  is contacted. Email needs SMTP (degrades gracefully). Rebuild backend +
  frontend (`docker compose … up -d --build`).
- Super-admin only.

## Tests
`backend/tests/integration/invoices.int.test.ts` — draft + tax math, FY numbering
+ sequence, billing fields, PDF endpoint (200/application-pdf), offline mark-paid +
reference, void guards, tenant scoping, non-super-admin → 403.

## Rollback
Additive only. Revert the PR to remove endpoints/UI. The tables are inert (no
existing table references them); leave them in place if any invoice exists, or
drop `saas_invoice_lines, saas_invoices, saas_invoice_counters` via an explicit,
gated script only when empty. No existing data is touched by any rollback.

## Not in B2 (follow-ups)
Full GST (CGST/SGST/IGST, HSN) = **B2.1** after accountant review · recurring /
gateway charging + dunning = **B4** (gated on credentials) · credit notes /
partial payments.
