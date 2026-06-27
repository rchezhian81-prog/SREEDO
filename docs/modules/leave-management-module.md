# Leave Management Module

> **Status:** Implemented · **Backend:** `backend/src/modules/staffleave` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Leave Management module handles staff leave: leave types (paid/unpaid with a
default balance), per-staff leave balances, and the request → approve/reject
lifecycle. Approving a leave **deducts the configured balance** and **auto-marks
staff attendance** as `leave` for each day in range; cancelling an approved
leave reverses both. The module lives alongside Staff Attendance in the same
backend folder (`staffleave/`), which also feeds the Payroll module's
attendance summary.

Mounted at `/api/v1/leave` (the leave router); the sibling staff-attendance
router is mounted at `/api/v1/staff` (`backend/src/app.ts`).

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Leave admin: manage leave types, set balances, approve/reject/cancel, act for others; sees all staff data. |
| `accountant` | Sees all staff leave data (in `VIEW_ALL`); actions depend on granted keys. |
| `super_admin` | Cross-tenant; in `VIEW_ALL`; bypasses permission checks. |
| `teacher` / staff | Request their own leave, view their own requests/balances, cancel their own pending request. Scoped to their linked `teachers` record. |

Scoping rule: roles in `VIEW_ALL` (`admin`, `accountant`, `super_admin`) see all
staff; everyone else is restricted to their own `teachers` record (resolved via
`teachers.user_id`). Acting for others (passing a `teacherId`) is limited to
`admin` / `super_admin`.

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/leave/`

- `leave/page.tsx` — overview
- `leave/types/` — leave types (leave admin)
- `leave/balances/` — staff leave balances
- `leave/requests/` — request leave / my requests
- `leave/approvals/` — approve/reject pending requests

(Staff attendance has its own pages under `staff/`.)

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/leave/types` | List leave types | `leave:read` |
| POST | `/leave/types` | Create a leave type (leave admin) | `leave:approve` |
| PATCH | `/leave/types/:id` | Update a leave type | `leave:approve` |
| DELETE | `/leave/types/:id` | Delete a leave type | `leave:approve` |
| GET | `/leave/balances` | List balances (staff see own) | `leave:read` |
| POST | `/leave/balances` | Set a balance (upsert, leave admin) | `leave:approve` |
| GET | `/leave/requests` | List requests (staff see own) | `leave:read` |
| POST | `/leave/requests` | Request leave (admins may pass `teacherId`) | `leave:create` |
| POST | `/leave/requests/:id/approve` | Approve (deducts balance, marks attendance) | `leave:approve` |
| POST | `/leave/requests/:id/reject` | Reject a pending request | `leave:reject` |
| POST | `/leave/requests/:id/cancel` | Cancel (own pending; admins any pending/approved) | `leave:read` |

Related staff-attendance routes (same folder, mounted at `/staff`,
`staff_attendance:*` permissions): `GET/POST /staff/attendance`,
`GET /staff/attendance/summary`, `GET /staff/attendance/payroll-summary`,
`PATCH/DELETE /staff/attendance/:id`.

All routes require JWT Bearer + tenant context. `leave:approve` doubles as the
"leave admin" gate for leave types and balances.

## 5. Database tables / entities

- `leave_types` — `name`, `code` (unique per tenant), `is_paid` (default true),
  `default_balance`, `is_active`.
- `leave_balances` — `teacher_id`, `leave_type_id`, `balance`; unique per
  `(institution_id, teacher_id, leave_type_id)` (upsert).
- `leave_requests` — `teacher_id`, `leave_type_id`, `start_date`, `end_date`,
  `days` (inclusive), `reason`, `status` ∈
  `pending | approved | rejected | cancelled`, `approver_id`, `decided_at`,
  `decision_note`.

Closely related (Staff Attendance, same folder): `staff_attendance` —
`teacher_id`, `date`, `status` ∈ `present | absent | half_day | leave | holiday`,
`check_in`, `check_out`, `late`, `early_out`, `leave_type_id`, `remarks`; unique
per `(institution_id, teacher_id, date)`.

## 6. Permissions / RBAC involved

- `leave:read` — view types, balances, requests (own-scoped for non-VIEW_ALL); also gates cancel
- `leave:create` — request leave
- `leave:approve` — approve; also the admin gate for leave types and balances
- `leave:reject` — reject a request

Sibling Staff Attendance keys: `staff_attendance:read | create | update | delete`.

`super_admin` bypasses checks. Own-record scoping is enforced in the route
handlers (not via a permission key).

## 7. Tenant isolation notes

All tables carry `institution_id`; both routers apply `requireTenant` and every
query filters by it. `assertTeacher` validates staff against the tenant.
Own-record scoping uses `teacherIdForUser` (matching `teachers.user_id` within
the tenant). Integration test "is tenant-scoped (no cross-institution access)"
and "owner-scopes staff to their own attendance/leave" cover this.

## 8. Key workflows

1. **Setup** — leave admin creates leave types (paid/unpaid) and sets per-staff
   balances.
2. **Request** — staff `POST /leave/requests` for themselves (admins may pass a
   `teacherId`). `days` is computed inclusively from `start_date`..`end_date`.
3. **Approve** — `POST /leave/requests/:id/approve` (transaction): if a balance
   row exists for the type, enforce sufficiency and deduct `days`; then upsert
   `staff_attendance` to `leave` for every date in range (`generate_series`);
   mark the request `approved`.
4. **Reject** — `POST /leave/requests/:id/reject` marks a pending request
   `rejected` without touching balance/attendance.
5. **Cancel / reverse** — `POST /leave/requests/:id/cancel`. A pending request
   is simply cancelled. An approved request is reversed: balance restored and
   the auto-created `leave` attendance rows in the range deleted. Staff may
   cancel only their own request.

Downstream: `payrollSummary` aggregates attendance (working/present/absent/
half/paid-leave/unpaid-leave/late) per staff member for the Payroll module.

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md).

## 9. Test coverage summary

Integration tests in `backend/tests/integration/staffleave.int.test.ts` (9
cases, need `DATABASE_URL`; `npm run test:integration`): bulk staff-attendance
upsert + monthly summary; request → approve flow (balance deduction, attendance
marking); reject without side effects; approval blocked on insufficient balance;
cancel of an approved leave (restores balance, removes attendance); owner-
scoping of staff to their own data; leave + payroll reports in the Reports
Center; permission guards; and tenant scoping. No dedicated unit tests.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "Insufficient leave balance" (409) on approve | Balance row < requested `days` | Top up the balance, or approve a shorter range |
| "No staff record is linked to your account" (403) | User has no `teachers.user_id` link | Link the staff record to the login |
| Empty list for a teacher | Non-VIEW_ALL role only sees own data | Use an admin/accountant account to see all |
| "End date must be on or after start date" | Reversed dates | Fix `startDate`/`endDate` |
| Approve didn't mark attendance | Existing rows / wrong dates | The upsert sets `leave` per day; verify the range |
| Cannot cancel a rejected/cancelled request | Only pending/approved are cancellable | No action needed |
| Approving leave changed nothing in balance | No balance row exists for that staff+type | Balances are optional; deduction only applies when a row exists |

## 11. Future enhancement notes

- Multi-level / configurable approval chains.
- Half-day and hourly leave units.
- Holiday calendar integration (auto-exclude holidays from `days`).
- Carry-forward / accrual policies for balances.
- Leave notifications to approvers and applicants (reuse Communication).
- Self-service portal view of remaining balances for all staff.
