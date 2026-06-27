# SaaS Invoicing — Billing Phase B2 (gateway-free)

Lets the operator **invoice institutions** for their subscription and record
**offline** payment (bank transfer / cheque / UPI reference). This is Phase B2 of
`docs/SAAS_BILLING_ROADMAP.md`. **No payment gateway, no auto-charging, additive
migration only, super-admin only.**

> Separate from **student fee collection** (`modules/fees`, `modules/onlinepayments`)
> and from **subscription lifecycle** (B1, `docs/modules/subscription-lifecycle.md`).

## Lifecycle
```
draft ──issue──▶ issued ──mark-paid──▶ paid
  │                  │
  └──────void───────┴── void        (a paid invoice cannot be voided)
```
- **draft** — editable; line items can be added; not numbered.
- **issue** — assigns the next sequential number (`SINV-000001`), freezes totals,
  sets `issued_at`. Drafts never consume a number.
- **mark-paid** — records OFFLINE payment (`payment_method`, `paid_at`). Manual,
  super-admin action — there is no gateway callback.
- **void** — for a draft or issued invoice; a **paid** invoice cannot be voided.

## Schema — migration `0073_saas_invoices.sql` (additive, safe)
- `saas_invoices` — institution_id, `number` (UNIQUE, NULL until issued), status
  CHECK(`draft|issued|paid|void`), currency, period_start/end, `subtotal`,
  `tax_percent`, `tax_amount`, `total` (all NUMERIC(12,2)), notes, issued_at,
  paid_at, payment_method, created_by, timestamps.
- `saas_invoice_lines` — invoice_id, description, quantity, unit_price, amount.
- `saas_invoice_seq` — sequence backing the invoice number.
- New tables/sequence only; no existing table changed; no data deleted.

**Totals** are computed in SQL with NUMERIC to avoid float drift:
`line.amount = round(quantity × unit_price, 2)`, `subtotal = Σ amount`,
`tax_amount = round(subtotal × tax_percent / 100, 2)`, `total = subtotal + tax_amount`.
Tax is **optional** — `tax_percent` defaults to `0`.

## Endpoints (super-admin, under `/platform`)
| Method | Path | Permission |
|---|---|---|
| POST | `/platform/institutions/:id/invoices` | `platform:manage_subscriptions` |
| GET | `/platform/institutions/:id/invoices` | `platform:read` |
| GET | `/platform/invoices` (`?status=`) | `platform:read` |
| GET | `/platform/invoices/:id` | `platform:read` |
| POST | `/platform/invoices/:id/lines` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/issue` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/mark-paid` | `platform:manage_subscriptions` |
| POST | `/platform/invoices/:id/void` | `platform:manage_subscriptions` |

Create body: `{ periodStart?, periodEnd?, currency?, taxPercent?, notes?, lines?: [{ description, quantity?, unitPrice? }] }`.
Mark-paid body: `{ paymentMethod, paidAt? }`.

## Configuration (env)
| Var | Default | Meaning |
|---|---|---|
| `SAAS_INVOICE_PREFIX` | `SINV-` | invoice number prefix |
| `SAAS_INVOICE_CURRENCY` | `INR` | default currency for new invoices |

## Deployment notes
- **Migration auto-applies on boot** (`runMigrations()` in `server.ts`).
- **No behaviour change on deploy** — invoicing is operator-initiated; nothing runs
  automatically. No payment gateway is contacted.
- Super-admin only.

## Tests
- `backend/tests/integration/invoices.int.test.ts` — draft + tax computation,
  issue + sequential numbering, offline mark-paid, void guards, tenant scoping,
  non-super-admin rejection.

## Not in B2 (future phases / follow-ups)
- **UI** — a super-admin invoicing screen is a planned follow-up (mirrors the
  B1 → B1-UI split); B2 here is API + data model.
- **PDF** rendering of invoices.
- **Recurring / gateway charging, dunning** — Phase B4 (gated on credentials).
- **GSTIN / place-of-supply** tax metadata beyond a flat `tax_percent`.
