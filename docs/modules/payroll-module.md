# Payroll Module

> **Status:** Implemented · **Backend:** `backend/src/modules/payroll` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Payroll module computes monthly staff salaries: reusable salary components
(earnings/deductions, fixed or percentage), per-staff salary structures with
revision history, monthly payroll runs that compute gross/deductions/net using
the Staff Leave & Attendance module's payroll summary, run finalization
(locking), and payslips with downloadable PDFs. Staff can view and download
their own payslips.

Mounted at `/api/v1/payroll` (see `backend/src/app.ts`). It reads attendance via
`payrollSummary` / `teacherIdForUser` from
`backend/src/modules/staffleave/staffleave.service.ts`.

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Full payroll administration (components, structures, runs, finalize). |
| `accountant` | Run/finalize payroll, view payslips (depends on `payroll:*` keys); privileged for any-staff payslip PDF. |
| `teacher` / staff | View and download their own payslips (`payroll:payslip` + owner scoping). |
| `super_admin` | Cross-tenant; bypasses permission checks; privileged for PDFs. |

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/payroll/`

- `payroll/page.tsx` — overview
- `payroll/components/` — salary components
- `payroll/structures/` — staff salary structures
- `payroll/run/` — run/finalize monthly payroll
- `payroll/payslips/` — payslip listing (admin/accountant)
- `payroll/my-payslips/` — the signed-in staff member's payslips
- `payroll/reports/` — payroll reporting

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/payroll/components` | List salary components | `payroll:read` |
| POST | `/payroll/components` | Create a component | `payroll:create` |
| PATCH | `/payroll/components/:id` | Update a component | `payroll:update` |
| DELETE | `/payroll/components/:id` | Delete a component (blocked if in use) | `payroll:delete` |
| GET | `/payroll/structures` | List structures (filter staff) | `payroll:read` |
| POST | `/payroll/structures` | Assign a structure (supersedes active) | `payroll:create` |
| GET | `/payroll/structures/:id` | Get a structure with component lines | `payroll:read` |
| DELETE | `/payroll/structures/:id` | Delete a structure | `payroll:delete` |
| GET | `/payroll/runs` | List runs (+ payslip counts, net totals) | `payroll:read` |
| POST | `/payroll/runs` | Run monthly payroll (idempotent; `recalc` needs `payroll:update`) | `payroll:run` |
| POST | `/payroll/runs/:id/finalize` | Finalize/lock a run and its payslips | `payroll:finalize` |
| GET | `/payroll/payslips` | List payslips (filter run/staff/month) | `payroll:read` |
| GET | `/payroll/payslips/mine` | The signed-in staff member's payslips | `payroll:payslip` |
| GET | `/payroll/payslips/:id` | Get a payslip with its lines | `payroll:read` |
| GET | `/payroll/payslips/:id/pdf` | Download payslip PDF (owner-scoped) | `payroll:payslip` |

All routes require JWT Bearer + tenant context. Two extra checks beyond the
permission key: running with `recalc` additionally requires `payroll:update`;
the PDF route is owner-scoped (staff get only their own — admin/accountant/
super_admin get any).

## 5. Database tables / entities

- `salary_components` — `name`, `code` (unique per tenant), `type` ∈
  `earning | deduction`, `calc_type` ∈ `fixed | percent`, `default_value`,
  `is_active`.
- `salary_structures` — `teacher_id`, `effective_date`, `is_active`; a new active
  structure supersedes the previous one for that staff member (revision history).
- `salary_structure_components` — `structure_id`, `component_id`, `calc_type`,
  `value`.
- `payroll_runs` — `month` (stored as the first of the month, unique per tenant),
  `status` ∈ `draft | finalized`, `notes`, `created_by`, `finalized_by`,
  `finalized_at`.
- `payslips` — `run_id`, `teacher_id`, `month`, attendance counts
  (`working_days`, `present_days`, `absent_days`, `paid_leave`, `unpaid_leave`,
  `half_days`, `late_count`), `gross`, `deductions`, `net`, `status`. Unique per
  staff+month.
- `payslip_lines` — `payslip_id`, `component_id` (nullable for synthetic lines
  like "Unpaid Leave"), `name`, `type`, `amount`.

PDF generation reads the institution logo from `documents` (via `storage`).

## 6. Permissions / RBAC involved

- `payroll:read` — view components, structures, runs, payslips
- `payroll:create` — create components and structures
- `payroll:update` — update components; required additionally to `recalc` a run
- `payroll:delete` — delete components and structures
- `payroll:run` — run monthly payroll
- `payroll:finalize` — finalize/lock a run
- `payroll:payslip` — list own payslips and download payslip PDFs

`super_admin` bypasses checks. Payslip PDF access is further owner-scoped in the
service.

## 7. Tenant isolation notes

All tables carry `institution_id`; `requireTenant` is router-wide and every
query filters by it. Staff/teacher references are validated against the tenant.
The run computation, finalize, and structure creation use transactions scoped to
`institution_id`. Integration test "is tenant-scoped (no cross-institution
access)" covers this.

## 8. Key workflows

1. **Component & structure setup** — define earning/deduction components, then
   assign a salary structure to each staff member. Creating a structure marks
   the staff member's previous active structure inactive (revision history).
2. **Computation** — for each structure line: `fixed` uses the value as-is;
   `percent` is computed on the **fixed-earnings total** (the "basic" base).
   Gross = sum of earnings; deductions = sum of deduction lines plus an
   automatic **unpaid-leave deduction** (gross ÷ days-in-month × unpaid days);
   net = gross − deductions.
3. **Run** — `POST /payroll/runs` with `month`. Upserts the `payroll_runs` row
   (`ON CONFLICT DO NOTHING`), locks it, and for each staff member with an active
   structure: skips if a payslip already exists (unless `recalc`, which deletes
   and recomputes — requires `payroll:update`). Rejects if the month is already
   finalized. Returns `{ runId, month, generated, skipped }`.
4. **Finalize** — `POST /payroll/runs/:id/finalize` sets the run and its
   payslips to `finalized` (locked); 409 if already finalized.
5. **Payslips** — list/filter, view lines, or download PDF. Staff use
   `/payslips/mine` and the owner-scoped PDF route.

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md) and the Staff Leave module for
the attendance inputs.

## 9. Test coverage summary

Integration tests in `backend/tests/integration/payroll.int.test.ts` (9 cases,
need `DATABASE_URL`; `npm run test:integration`): component + structure
management with revision history; gross/deductions/net computation (fixed +
percent); unpaid-leave deduction from the attendance summary; duplicate-run
prevention and `recalc`; run finalization/locking; payslip PDF generation
owner-scoped to the staff member; payroll reports in the Reports Center;
permission guards; and tenant scoping. No dedicated unit tests for this module.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "Payroll for this month is finalized" (409) | Run already finalized | Cannot re-run; create a correction outside the locked run |
| Run `generated` is 0 | No staff have an active salary structure | Assign structures before running |
| Existing payslips unchanged on re-run | Run is idempotent without `recalc` | Re-run with `recalc: true` (needs `payroll:update`) |
| "Recalculation requires payroll:update" | Role lacks `payroll:update` | Grant the key or run without `recalc` |
| "Component is in use by a salary structure" | Component referenced by a structure | Remove it from structures first, or deactivate |
| Percent component computes 0 | No fixed earnings to base the percentage on | Add a fixed earning component (the "basic") |
| 403 on payslip PDF | Non-privileged staff requesting another's payslip | Staff may download only their own |

## 11. Future enhancement notes

- Bank-transfer / payout file export (e.g. NEFT batch).
- Statutory components (PF/ESI/TDS) with slab-based computation.
- Loan/advance tracking and recovery schedules.
- Bulk payslip email distribution (reuse Communication channels).
- Configurable working-days basis (calendar vs. attendance-derived).
