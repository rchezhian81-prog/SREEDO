# Fees & Payments Module

> **Status:** Implemented · **Backend:** `backend/src/modules/fees` (+ `backend/src/modules/onlinepayments`, `backend/src/modules/pdfs` for receipts) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
End-to-end fee billing and collection. Two layers in one module:
- **Core billing** (`fees.service.ts`): fee structures, invoices, offline
  payments (with an overpayment guard) and a collection summary.
- **Fee management depth** (`feedepth.service.ts`): fee categories, term-wise
  fee schedules (bulk invoice generation), late-fine rules + applied fines
  (with waiver), discounts/scholarships + applied discounts (with approval),
  and an invoice breakdown.

Online card/UPI collection is the separate **onlinepayments** module
(`/api/v1/online-payments`); receipt PDFs come from the **pdfs** module
(`/api/v1/fee-receipts`). See *MODULE_WORKFLOWS.md §H — Fee management* and
*§T — Online Fee Gateway*.

## 2. User roles involved
- **admin** — full access: structures, invoices, payments, categories,
  schedules, fines (incl. waive), discounts (incl. approve), reports.
- **accountant** — billing + setup + apply, **except** category delete, fine
  waive and discount approve (see permission grants in `0033`).
- **teacher** — no billing access.
- **student / parent** — read **their own / their child's** invoices and
  invoice breakdown only (owner-scoped); cannot see school-wide totals.

## 3. Main screens / pages
- `/fees` — `frontend/src/app/(dashboard)/fees/page.tsx`: invoices list,
  payment recording, structures and the collection summary.
- `/fees/setup` — fee categories, schedules, fine rules and discounts.

## 4. Main backend APIs
Base path `/api/v1/fees`; router requires `authenticate` + `requireTenant`.
Core billing writes use `authorize("admin","accountant")` (shown as
*billing*); depth endpoints use granular `fee_*` permission keys.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/fees/structures` | List fee structures | Authenticated |
| POST | `/fees/structures` | Create a fee structure | billing (admin/accountant) |
| GET | `/fees/invoices` | List invoices (page, limit, `studentId`, `status`); owner-scoped | Authenticated |
| POST | `/fees/invoices` | Raise an invoice for a student | billing |
| GET | `/fees/invoices/{id}` | Invoice with payment history | Authenticated + `assertStudentAccess()` |
| POST | `/fees/invoices/{id}/payments` | Record a payment (overpay guarded) | billing |
| GET | `/fees/summary` | School-wide collection totals | `requireStaff` |
| GET | `/fees/categories` | List fee categories | `fee_categories:read` |
| POST | `/fees/categories` | Create a category | `fee_categories:create` |
| PATCH | `/fees/categories/{id}` | Update a category | `fee_categories:update` |
| DELETE | `/fees/categories/{id}` | Delete a category | `fee_categories:delete` |
| GET | `/fees/schedules` | List fee schedules | `fee_schedules:read` |
| POST | `/fees/schedules` | Create a term-wise schedule | `fee_schedules:create` |
| PATCH | `/fees/schedules/{id}` | Update a schedule | `fee_schedules:update` |
| GET | `/fees/schedules/{id}/preview` | Preview target students | `fee_schedules:generate` |
| POST | `/fees/schedules/{id}/generate` | Generate invoices (idempotent) | `fee_schedules:generate` |
| GET | `/fees/fine-rules` | List late-fine rules | `fee_fines:read` |
| POST | `/fees/fine-rules` | Create a fine rule | `fee_fines:apply` |
| POST | `/fees/invoices/{id}/fines` | Apply a fine to an invoice | `fee_fines:apply` |
| POST | `/fees/fines/apply-overdue` | Apply rules to all overdue invoices | `fee_fines:apply` |
| POST | `/fees/applied-fines/{id}/waive` | Waive an applied fine | `fee_fines:waive` |
| GET | `/fees/discounts` | List discounts/scholarships | `fee_discounts:read` |
| POST | `/fees/discounts` | Create a discount/scholarship | `fee_discounts:apply` |
| POST | `/fees/invoices/{id}/discounts` | Apply a discount (pending) | `fee_discounts:apply` |
| POST | `/fees/applied-discounts/{id}/approve` | Approve a discount (reduces net) | `fee_discounts:approve` |
| GET | `/fees/invoices/{id}/breakdown` | Base / fines / discounts / outstanding | Authenticated + `assertStudentAccess()` |

Related (separate modules): `GET /fee-receipts/{paymentId}/download`
(`fee_receipts:download`); online gateway under `/api/v1/online-payments`
(`online_payments:*`). A `fee_reports:read` permission backs dues/collection
reports.

Validation: payment `method ∈ {cash, card, bank_transfer, upi, cheque,
online}`; invoice status `∈ {pending, partially_paid, paid, cancelled}`; fine
`fineType ∈ {fixed, per_day, percent}`; discount `discountType ∈ {fixed,
percent}`, `kind ∈ {discount, scholarship}`.

## 5. Database tables / entities
- **fee_structures** — reusable fee definitions (`amount`, `frequency`).
- **invoices** — `invoice_no`, `student_id`, `amount_due` (NET payable),
  `amount_paid`, `due_date`, `status`; augmented in `0033` with `category_id`,
  `fee_schedule_id`, `discount_total`, `fine_total`. `base = amount_due +
  discount_total − fine_total`.
- **payments** — `invoice_id`, `amount`, `method`, `reference`, `received_by`.
- **fee_categories**, **fee_schedules**, **fee_fine_rules**, **fee_discounts**
  (rules); **invoice_fines** (applied, `status ∈ {applied, waived}`),
  **invoice_discounts** (applied, `status ∈ {pending, approved, rejected}`)
  — all from `0033_fee_management.sql`, all tenant-scoped.
- A unique index `(fee_schedule_id, student_id)` makes schedule generation
  idempotent (one invoice per schedule+student).

## 6. Permissions / RBAC involved
Core billing (`/structures`, `/invoices`, `/payments`) uses the legacy
`authorize("admin","accountant")` gate; `/summary` uses `requireStaff`. All
depth endpoints use granular `fee_categories:*`, `fee_schedules:*`,
`fee_fines:*`, `fee_discounts:*` keys (seeded in `0033`). Accountant grants
deliberately **exclude** `fee_categories:delete`, `fee_fines:waive` and
`fee_discounts:approve` (admin-only controls).

## 7. Tenant isolation notes
Every table carries `institution_id`; all queries filter/stamp it.
Student/parent reads of invoices and breakdown are further constrained by
`accessibleStudentIds()`/`assertStudentAccess()`. The fee summary is staff-only.
Cross-institution access to setup and invoices is rejected (verified by
`feedepth.int.test.ts`).

## 8. Key workflows
1. **Define structures/categories.** Admin/accountant create reusable fee
   structures and categories.
2. **Raise an invoice.** `POST /fees/invoices` with student, description, net
   `amountDue`, due date; an `invoice_no` (`INV-YYYYMMDD-XXXXXX`) is generated.
3. **Term-wise bulk billing.** Create a schedule (optional class/section/
   student/year targets, ANDed; all null = every active student), `preview`
   the target set, then `generate` — idempotent via the unique index.
4. **Record a payment.** `POST /invoices/{id}/payments` locks the invoice row
   `FOR UPDATE`, **rejects amounts above the outstanding balance**, inserts the
   payment, advances status to `partially_paid`/`paid`, and emails a receipt to
   the guardian best-effort (only when SMTP is configured; failure never blocks
   the payment).
5. **Late fines.** Apply a fine to one invoice, or sweep all overdue invoices
   (`/fines/apply-overdue`); admins may `waive`. Fines add to `amount_due` /
   `fine_total`.
6. **Discounts/scholarships.** Apply → status `pending`; an approver reduces
   `amount_due` on approval.
7. **Breakdown & reporting.** `/invoices/{id}/breakdown` returns base, fine
   total, discount total and outstanding; `fee_reports:read` backs dues reports.
8. **Online + receipts.** The onlinepayments gateway writes net-amount
   payments compatibly; receipt PDFs download via `/fee-receipts`.

## 9. Test coverage summary
Strong, dedicated coverage: `fees.int.test.ts` (amount_paid lifecycle,
**overpayment rejection**, staff-only summary) and `feedepth.int.test.ts`
(category CRUD permission gating, schedule generation + duplicate prevention,
per-day fine calc + waiver, discount apply→approve, owner-scoped dues,
dues reports, online-gateway net-amount compatibility, tenant isolation,
cross-institution denial). Online payments and receipts are covered by their
own suites.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 400 "Payment exceeds outstanding balance" | Amount > (amount_due − amount_paid) | Pay ≤ outstanding; the guard blocks overpayment |
| 400 paying a cancelled invoice | Invoice `status = cancelled` | Re-issue an invoice |
| No receipt email after payment | SMTP not configured, or no `guardian_email` | Configure SMTP; ensure the student has a guardian email |
| Schedule generate created no new invoices | Already generated (idempotent) | Expected; the unique index prevents duplicates |
| Accountant 403 on waive/approve/category-delete | Those keys are admin-only | Use an admin account |
| Student sees no invoices / summary | Owner scope; summary is staff-only | Use `/invoices` (scoped); summary needs staff |

## 11. Future enhancement notes
- Migrate core billing routes onto granular `fees:*` keys to match depth endpoints.
- Configurable receipt templates and SMS receipt channel.
- Partial refunds against offline payments (online refunds already exist).
- Aging buckets and exportable dues statements per class/category.
