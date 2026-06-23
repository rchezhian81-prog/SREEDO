# Library Module

> **Status:** Implemented · **Backend:** `backend/src/modules/library` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Library module runs a school/college library's circulation desk: a catalogue
of titles with physical copies, a register of borrowers (students and staff),
and the issue → renew → return lifecycle with automatic overdue-fine
calculation. Late fines can be waived or **posted as a student invoice** in the
Fees module, tying library debts into the school's billing.

Circulation rules (loan period, fine-per-day, renewal cap, per-member borrowing
limit) are configurable per institution; sensible defaults apply when no row
exists (14 loan days, fine 1/day, 2 renewals, 3 books per member).

Mounted at `/api/v1/library` (see `backend/src/app.ts`).

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Full library administration (settings, catalogue, members, fines). |
| `accountant` / librarian-style staff | Issue/return at the desk; post fines to invoices (depends on which `library:*` keys the role holds). |
| `teacher` | May read the catalogue or be registered as a staff member (depends on granted permissions). |
| `student` / `parent` | View the student's own borrowing history via the owner-scoped portal route. |
| `super_admin` | Cross-tenant; bypasses permission checks. |

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/library/`

- `library/page.tsx` — module landing/overview
- `library/catalogue/` — titles & search
- `library/books/` — book + copy management
- `library/members/` — borrower register
- `library/circulation/` — issue/return/renew desk
- `library/reports/` — library reporting (Reports Center surface)

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/library/settings` | Get circulation settings | `library:read` |
| PATCH | `/library/settings` | Update circulation settings | `library:update` |
| GET | `/library/categories` | List categories (with book counts) | `library:read` |
| POST | `/library/categories` | Create a category | `library:create` |
| PATCH | `/library/categories/:id` | Update a category | `library:update` |
| DELETE | `/library/categories/:id` | Delete a category | `library:delete` |
| GET | `/library/books` | List/search books (+ total/available copies) | `library:read` |
| POST | `/library/books` | Create a book (optionally auto-create N copies) | `library:create` |
| GET | `/library/books/:id` | Get a book with its copies | `library:read` |
| PATCH | `/library/books/:id` | Update a book | `library:update` |
| DELETE | `/library/books/:id` | Delete a book (blocked if copies on loan) | `library:delete` |
| GET | `/library/books/:id/copies` | List a book's copies | `library:read` |
| POST | `/library/books/:id/copies` | Add a copy (accession auto-generated) | `library:create` |
| PATCH | `/library/copies/:id` | Update a copy (not the loan status) | `library:update` |
| DELETE | `/library/copies/:id` | Delete a copy (blocked if on loan) | `library:delete` |
| GET | `/library/members` | List members (+ open-loan counts) | `library:read` |
| POST | `/library/members` | Register a member (student or staff) | `library:create` |
| PATCH | `/library/members/:id` | Update a member (status/code) | `library:update` |
| DELETE | `/library/members/:id` | Delete a member (blocked with books out) | `library:delete` |
| GET | `/library/members/:id/history` | Member borrowing history | `library:read` |
| POST | `/library/issues` | Issue a book (by copyId or bookId) | `library:issue` |
| POST | `/library/issues/:id/renew` | Renew an open issue | `library:issue` |
| POST | `/library/issues/:id/return` | Return a book (computes late fine) | `library:return` |
| POST | `/library/issues/:id/waive-fine` | Waive a pending fine | `library:fines` |
| POST | `/library/issues/:id/post-fine` | Post a pending fine to a student invoice | `library:fines` |
| GET | `/library/students/:studentId/history` | A student's own history (portal) | Owner-scoped (no permission key) |

All staff routes require a JWT Bearer token plus tenant context (`authenticate`,
`requireTenant`). The portal history route is owner-scoped via
`accessibleStudentIds` / `assertStudentAccess` instead of a `library:*` key.

## 5. Database tables / entities

- `library_settings` — per-institution circulation config (`loan_days`,
  `fine_per_day`, `max_renewals`, `max_books_per_member`), unique per
  `institution_id`.
- `book_categories` — catalogue categories (`name`, `code`).
- `books` — titles (`title`, `author`, `isbn`, `publisher`, `edition`,
  `subject`, `language`, `rack_location`, `category_id`).
- `book_copies` — physical copies (`accession_number`, `barcode`, `status` ∈
  `available | issued | lost | damaged | retired`).
- `library_members` — borrowers (`member_type` ∈ `student | staff`,
  `student_id` / `teacher_id`, `member_code`, `status`).
- `book_issues` — circulation ledger (`copy_id`, `book_id`, `member_id`,
  `issue_date`, `due_date`, `return_date`, `status`, `renewed_count`,
  `fine_amount`, `fine_status` ∈ `none | pending | waived | posted`,
  `invoice_id`, `issued_by`, `returned_by`).

Fine posting writes a row into the Fees module's `invoices` table
(`invoice_no` prefixed `LIB-`).

See [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md) for column-level detail.

## 6. Permissions / RBAC involved

Enforced by `requirePermission(key)` (cached ~60s):

- `library:read` — view settings, categories, books, copies, members, history
- `library:create` — create categories, books, copies, members
- `library:update` — update settings, categories, books, copies, members
- `library:delete` — delete categories, books, copies, members
- `library:issue` — issue and renew
- `library:return` — return
- `library:fines` — waive and post fines

`super_admin` bypasses all checks. The portal student-history route is not
gated by a `library:*` key — it relies on owner scoping.

## 7. Tenant isolation notes

Every table carries `institution_id`. The router applies `requireTenant`, and
every service query filters by `institution_id` (and reference checks via
`assertRef` confirm the referenced row belongs to the same tenant). The
integration test "is tenant-scoped (no cross-institution access)" exercises
this. Cross-tenant access is therefore not possible through normal staff or
portal routes; only `super_admin` operates cross-tenant.

## 8. Key workflows

1. **Catalogue setup** — create categories, then books (optionally with
   `copyCount` to auto-generate accession-numbered copies), or add copies
   individually.
2. **Issue** — `POST /library/issues` with `memberId` plus a `copyId` (specific
   copy) or `bookId` (picks any available copy via `FOR UPDATE SKIP LOCKED`).
   Rejects if the member is inactive, has hit the borrowing limit, or no copy is
   available. Due date defaults to today + `loan_days`. Copy flips to `issued`.
3. **Renew** — `POST /library/issues/:id/renew` extends the due date by
   `loan_days` while `renewed_count < max_renewals`; otherwise 409.
4. **Return** — `POST /library/issues/:id/return` with optional `condition`
   (`ok | lost | damaged`). Computes `fine_amount = max(0, returnDate - dueDate)
   × fine_per_day`; sets `fine_status` to `pending` when > 0. Copy goes back to
   `available` (or `lost` / `damaged`).
5. **Fine resolution** — waive (`fine_status → waived`) or post to a student
   invoice (`fine_status → posted`, creates an `invoices` row; only valid for
   student members).

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md) for the cross-module flow.

## 9. Test coverage summary

Integration tests in `backend/tests/integration/library.int.test.ts` (9 cases,
require a disposable Postgres via `DATABASE_URL`; run with
`npm run test:integration`). They cover: catalogue management (category → book →
copies); issue/over-issue prevention/return; borrowing-limit enforcement;
overdue-fine computation with post/waive; renewal up to the limit; staff member
history and owner-scoped student history; library reports in the Reports Center;
permission guards; and tenant scoping. No dedicated unit tests for this module.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "No copies available" (409) on issue | All copies are `issued`/`lost`/`damaged`/`retired` | Add a copy, or wait for a return |
| "Member has reached the borrowing limit" | Open loans ≥ `max_books_per_member` | Return a book or raise the limit in settings |
| "Renewal limit reached" | `renewed_count` already at `max_renewals` | Return and re-issue, or raise `max_renewals` |
| "Member is not active" | Member `status` ≠ `active` | Reactivate the member before issuing |
| "Fines can only be posted to student invoices" | Member is staff, or has no `student_id` | Waive instead, or collect outside the Fees module |
| "Cannot delete a book that has issued copies" | A copy is still on loan | Return outstanding copies first |
| Wrong loan/fine values | No `library_settings` row → defaults used | PATCH `/library/settings` to set explicit values |

## 11. Future enhancement notes

- Reservations / holds queue for unavailable titles.
- Bulk import of catalogue and accession numbers.
- Email/SMS overdue reminders (could reuse the Communication module's
  background-job sweeps).
- Barcode/QR scanning at the circulation desk.
- Lost/damaged copy fine pricing distinct from per-day overdue fines.
