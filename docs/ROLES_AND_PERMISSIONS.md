# Roles & Permissions Matrix — SRE EDU OS

Deliverable **#4 User roles and permissions matrix**. Defines the full target
role set, the permission model, and a module × role access matrix. Marks what is
enforced **today** vs **planned**.

## 1. Roles

The brief specifies **13 roles**. The codebase implements **5** today; the rest
are delivered by the expanded role + permission system (Phase A).

| # | Role | Status | Notes |
|---|------|--------|-------|
| 1 | **Super Admin** | ⬜ planned | Above tenants: institutions, branches, packages, global settings, backups, audit |
| 2 | **Institution Admin** | ✅ (`admin`) | Full control within an institution |
| 3 | **Principal** | ⬜ planned | Academic + staff oversight, approvals, reports |
| 4 | **Vice Principal** | ⬜ planned | Subset of Principal |
| 5 | **Accountant** | ✅ (`accountant`) | Fees, invoices, payments, finance reports |
| 6 | **Office Staff** | ⬜ planned | Admissions, records, certificates (data entry) |
| 7 | **Teacher** | ✅ (`teacher`) | Attendance, marks, homework, timetable, notices |
| 8 | **Student** | ✅ (`student`) | Own records (portal) |
| 9 | **Parent** | ✅ (`parent`) | Child's records (portal) |
| 10 | **Librarian** | ⬜ planned | Library module |
| 11 | **Transport Manager** | ⬜ planned | Transport module |
| 12 | **Hostel Warden** | ⬜ planned | Hostel module |
| 13 | **HR / Payroll Staff** | ⬜ planned | Staff records, leave, payroll |

## 2. Permission model

**Today (role gate):** routes are guarded by `authorize(...roles)` — coarse,
role-based. Works well while only staff have logins.

**Target (role + permission + scope):**

- **Permissions** are `module:action` strings, e.g. `students:create`,
  `fees:read`, `attendance:write`, `payroll:approve`.
- **Roles** map to sets of permissions (`role_permissions`), overridable per
  institution.
- **Owner-scoping**: students/parents are additionally restricted to their own
  records at the query level (a parent's `students:read` returns only their
  children). This is the key gate before public portals launch (handover §8).
- Super Admin permissions are **global**; all others are **tenant-scoped** to
  the user's `institution_id`.

Enforcement layering: `authenticate` → `authorize`/`requirePermission` →
tenant scope → owner scope → service.

## 3. Module × role access matrix (target)

Legend: **F** full (CRUD) · **W** write (create/update) · **R** read ·
**R*** read own only · **—** none.

| Module | Super Admin | Inst. Admin | Principal | Vice Prin. | Accountant | Office | Teacher | Student | Parent | Librarian | Transport | Hostel | HR/Payroll |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Institutions/Branches | F | — | — | — | — | — | — | — | — | — | — | — | — |
| Packages/Subscription | F | R | — | — | — | — | — | — | — | — | — | — | — |
| Users & roles | F | F | R | R | — | W | — | — | — | — | — | — | R |
| System settings | F | W | R | — | — | — | — | — | — | — | — | — | — |
| Audit logs | F | R | R | — | — | — | — | — | — | — | — | — | — |
| Backups | F | W | — | — | — | — | — | — | — | — | — | — | — |
| Academics setup | R | F | W | W | — | W | R | R | R | — | — | — | — |
| Students | R | F | W | W | R | F | R | R* | R* | — | — | — | — |
| Staff/Teachers | R | F | W | W | — | W | R* | — | — | — | — | — | W |
| Attendance (student) | R | F | R | R | — | R | W | R* | R* | — | — | — | — |
| Attendance (staff) | R | F | R | R | — | R | R* | — | — | — | — | — | W |
| Exams & results | R | F | W | W | — | R | W | R* | R* | — | — | — | — |
| Fees | R | F | R | R | F | R | — | R* | R* | — | W | W | — |
| Timetable | R | F | W | W | — | R | R | R* | R* | — | — | — | — |
| Homework | R | F | R | R | — | — | F | R*/submit | R* | — | — | — | — |
| Communication/Notices | F | F | W | W | W | W | W | R | R | W | W | W | W |
| Library | R | F | R | — | — | — | R | R* | R* | F | — | — | — |
| Transport | R | F | R | — | R | R | — | R* | R* | — | F | — | — |
| Hostel | R | F | R | — | R | R | — | R* | R* | — | — | F | — |
| Inventory | R | F | R | — | R | W | — | — | — | R | R | R | — |
| Payroll | R | F | R | — | R | — | R* | — | — | — | — | — | F |
| Reports | R | F | R | R | R | R | R* | R* | R* | R | R | R | R |
| AI assistant | F | F | W | W | W | — | W | — | — | — | — | — | — |

> **Today's enforced subset:** `admin` = Institution Admin column;
> `accountant` = Accountant column; `teacher` = Teacher column;
> `student`/`parent` exist but portals/scoping are not yet built, so their
> logins are not issued in production yet. The full matrix above is the Phase-A+
> target.

## 4. Implementation plan for the matrix

1. **Phase A:** ✅ `permissions` + `role_permissions` tables, the
   `requirePermission('module:action')` middleware (cached, with `super_admin`
   bypass), and the seeded role matrix shipped (migration `0012`); owner-scoping
   of student reads is already live (utils/scope.ts). `authorize(...roles)`
   still works — routes migrate to `requirePermission` incrementally (the users
   module is the first). `GET /auth/permissions` exposes a user's effective keys.
2. ⬜ Add the remaining roles (`super_admin` done) — for the rest, grant via the
   matrix now (TEXT-keyed `role_permissions`) and add to the `user_role` enum
   when those logins are issued.
3. ⬜ Per-institution overrides via `role_permissions.institution_id` (with the
   `institution_id` scoping work).
