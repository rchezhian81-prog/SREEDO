# Staff & HR Module

> **Status:** Implemented · **Backend:** `backend/src/modules/teachers` + `backend/src/modules/users` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
There is **no single "HR" module**. Staff/HR concerns are split across two
backend modules plus two adjacent feature modules:
- **teachers** — the teaching-staff directory (employee records, qualifications).
- **users** — login accounts for all roles (admin/teacher/accountant/student/parent).
- **payroll** and **staff leave / staff attendance** are separate modules — see
  *Payroll module* and the staff-leave routes (`/api/v1/leave`, `/api/v1/staff`).

A teacher record (`teachers`) and a login (`users`) are distinct rows; a
teacher may optionally be linked to a user via `teachers.user_id`. See
*MODULE_WORKFLOWS.md §E — Staff / teacher management*.

## 2. User roles involved
- **admin** — full CRUD over teachers; manage user accounts (with `users:manage`).
- **teacher / accountant** (staff) — read the teacher directory.
- **super_admin** — platform role; bootstraps the first admin per institution.
- Students/parents have no access to staff data.

## 3. Main screens / pages
- `/teachers` — `frontend/.../(dashboard)/teachers/page.tsx`: teacher directory + form.
- `/staff` — `frontend/.../(dashboard)/staff/page.tsx` plus `attendance/`,
  `history/`, `reports/` subpages (staff attendance, served by the staff-leave module).
- `/users` — `frontend/.../(dashboard)/users/page.tsx`: user-account management.

## 4. Main backend APIs
Base path `/api/v1`. All routes require `authenticate` + `requireTenant`.

### Teachers (`/teachers`)
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/teachers` | List teachers (page, limit, `search`) | Authenticated (any tenant user) |
| POST | `/teachers` | Add a teacher; `employeeNo` auto-generated when omitted | `authorize("admin")` |
| GET | `/teachers/{id}` | Get one teacher | Authenticated |
| PATCH | `/teachers/{id}` | Update teacher (incl. `isActive`) | `authorize("admin")` |
| DELETE | `/teachers/{id}` | Permanently delete the teacher | `authorize("admin")` |

### Users (`/users`)
The whole router is gated by `requirePermission("users:manage")`.
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/users` | List user accounts (page, limit, `role`, `search`) | `users:manage` |
| POST | `/users` | Create a user account (hashes password) | `users:manage` |
| GET | `/users/{id}` | Get one user | `users:manage` |
| PATCH | `/users/{id}` | Update `fullName` / `phone` / `role` / `isActive` | `users:manage` |
| DELETE | `/users/{id}` | Deactivate (`is_active=false`) and revoke refresh tokens | `users:manage` |

Validation: `users.schema.ts` requires email (lower-cased), password
(≥8 chars, ≥1 letter, ≥1 digit), `fullName`, and `role ∈ {admin, teacher,
accountant, student, parent}`. `teachers.schema.ts` requires
`firstName`/`lastName`; optional email/phone/qualification/specialization/joiningDate.

## 5. Database tables / entities
- **teachers** (`0002_academics.sql`; tenant column added in `0013/0014`):
  `employee_no` (unique), name, email, phone, `qualification`, `specialization`,
  `joining_date`, `is_active`, optional `user_id` (→ `users`).
- **users** (`0001`): `email`, `password_hash`, `full_name`, `role`, `phone`,
  `is_active`, `institution_id`.
- **teacher_employee_seq** (`0009`): sequence backing `EMP-<0000>` numbers.
- **refresh_tokens** — deleted on user deactivation to force logout.

## 6. Permissions / RBAC involved
- **Teachers** use legacy role gates (`authorize("admin")` for writes; reads
  open to authenticated tenant users).
- **Users** use the granular key `users:manage` (whole router) via
  `requirePermission` — enforced and verified in `permissions.int.test.ts`.

## 7. Tenant isolation notes
All teacher and user queries filter/insert by `institution_id`. Creating a
user account places it in the caller's tenant. `super_admin` (institution
NULL) is a platform identity created outside these routes and not listed here.

## 8. Key workflows
1. **Add a teacher.** Admin POSTs `/teachers`; `assertWithinPlanLimit(…,'staff')`
   checks the plan staff cap; `nextEmployeeNo()` issues `EMP-0001…` when
   `employeeNo` is omitted.
2. **Create a login.** A `users:manage` holder POSTs `/users` with email,
   password and role; the password is bcrypt-hashed (`utils/password.ts`).
3. **Deactivate a user.** `DELETE /users/{id}` sets `is_active=false` and
   deletes the user's refresh tokens, immediately ending their sessions.
4. **Link a teacher to a login.** Set `teachers.user_id` (via seed/admin tooling)
   so the teacher can sign in; staff scope then applies.
5. **Payroll / leave / staff attendance.** Handled by the separate payroll and
   staff-leave modules — out of scope here.

## 9. Test coverage summary
Covered by the integration suite: `numbering.int.test.ts` (employee-number
sequence), `contract.int.test.ts` (`/teachers` smoke contract) for teachers;
`permissions.int.test.ts` (`users:manage` enforcement on `/users`) for users.
No dedicated `teachers.int.test.ts` / `users.int.test.ts` files.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 403 on any `/users` call | Caller lacks `users:manage` | Grant the permission to the role (see ROLES_AND_PERMISSIONS) |
| 409 creating a user | Email already in use in the tenant | Use a unique email |
| Password rejected | Fails policy (≥8 chars, letter + digit) | Supply a compliant password |
| 409 adding a teacher | Duplicate `employee_no` (manual value) | Omit `employeeNo` to use the sequence |
| User still "logged in" after deactivate | Stale access JWT (short-lived) | Access token expires; refresh is already revoked |

## 11. Future enhancement notes
- Unify teacher writes onto granular permission keys (e.g. `teachers:manage`).
- Self-service teacher↔user linking endpoint and onboarding invites.
- Soft-delete/archive for teachers (currently a hard `DELETE`).
- A consolidated HR view stitching teachers + payroll + leave dashboards.
