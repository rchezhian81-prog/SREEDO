# Students (Admissions) Module

> **Status:** Implemented · **Backend:** `backend/src/modules/students` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
Manages student admission and the full student lifecycle: enrolment with an
auto-generated admission number, search/filter listing, profile updates, and
soft-archive vs. hard-delete. Students are the central entity referenced by
attendance, fees, exams, report cards and the parent/student portal. See
*MODULE_WORKFLOWS.md §D — Student admission & lifecycle*.

## 2. User roles involved
- **admin** — full CRUD (enrol, update, archive, hard-delete).
- **teacher / accountant** (staff) — read all students in their tenant (list & detail).
- **student** — read **only their own** linked record.
- **parent** — read **only their linked children** (via the `guardians` table).
- **super_admin** — platform role, not tenant-scoped; not used for routine student management.

Scoping is enforced by `accessibleStudentIds(req)` / `assertStudentAccess()`
in `src/utils/scope.ts`: staff resolve to `null` (unrestricted); student →
their own id; parent → linked child ids.

## 3. Main screens / pages
- `/students` — `frontend/src/app/(dashboard)/students/page.tsx`: searchable,
  paginated, section/status-filtered table with create/edit form. This page is
  the canonical form/table reference pattern for the dashboard.

## 4. Main backend APIs
Base path `/api/v1`. All routes require `authenticate` + `requireTenant`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/students` | List students (page, limit, `sectionId`, `status`, `search`); archived hidden unless `status=archived` is requested; owner-scoped for student/parent | Authenticated; results filtered by `accessibleStudentIds()` |
| POST | `/students` | Enrol a student; `admissionNo` auto-generated when omitted | `authorize("admin")` |
| GET | `/students/{id}` | Get one student | Authenticated + `assertStudentAccess()` |
| PATCH | `/students/{id}` | Update fields (incl. `status`) | `authorize("admin")` |
| DELETE | `/students/{id}` | Archive (soft delete) by default; `?hard=true` permanently deletes and cascades | `authorize("admin")` |

Validation (zod, `students.schema.ts`): `firstName`/`lastName` required;
`gender ∈ {male, female, other}`; `status ∈ {active, inactive, graduated,
transferred, archived}`; `dateOfBirth` ISO date; `guardianEmail` email.

## 5. Database tables / entities
- **students** (migration `0002_academics.sql`; `institution_id` added in
  `0013/0014`): `admission_no` (unique), name, `date_of_birth`, `gender`,
  `section_id`, guardian fields, `address`, `status`, `enrolled_at`, `user_id`
  (links a student login). Indexed on `section_id` and `status`.
- **guardians** (migration `0016_guardians.sql`): many-to-many parent⇄child
  link (`user_id`, `student_id`, `relationship`); tenant-scoped; powers
  parent portal access.
- **student_admission_seq** (migration `0009`): Postgres sequence; admission
  numbers are `ADM-<year>-<0000>` via `nextval` (race-free).

## 6. Permissions / RBAC involved
This module predates the granular `module:action` keys and uses **legacy
role gates**: writes are `authorize("admin")`; reads are open to any
authenticated tenant user but row-filtered by owner scope. There is no
`students:*` permission key enforced on these routes (a legacy
`students:read` key exists in the catalogue and is granted to student/parent
for use by other read surfaces).

## 7. Tenant isolation notes
Every query filters by `institution_id` (supplied by `tenantId(req)`); inserts
stamp it. Cross-tenant reads/writes return 404 (verified by
`isolation.int.test.ts`). Hard delete cascades to dependent attendance,
invoices and payments; archive preserves history.

## 8. Key workflows
1. **Enrol a student.** Admin POSTs `/students`. `assertWithinPlanLimit` checks
   the tenant's plan student cap; `nextAdmissionNo()` draws from the sequence
   when `admissionNo` is omitted; the dashboard count cache is invalidated.
2. **List / search.** Staff get the full tenant roster; archived rows are
   hidden unless `status=archived` is passed. Student/parent callers are
   restricted to their accessible ids.
3. **Update / change status.** Admin PATCH; a `status` change invalidates the
   active-student dashboard count.
4. **Archive (default delete).** `DELETE /students/{id}` sets
   `status='archived'`, keeping attendance/fees history intact.
5. **Hard delete.** `DELETE /students/{id}?hard=true` removes the row and
   cascades to attendance/invoices/payments.
6. **Portal scoping.** A student's `user_id` links their login; a parent's
   `guardians` rows link their children for portal reads.

## 9. Test coverage summary
Covered by the backend integration suite (run via `npm run test:integration`):
`access.int.test.ts` (admin-only create, owner-scoped reads),
`isolation.int.test.ts` (cross-tenant 404s on get/patch/delete) and
`numbering.int.test.ts` (sequence-based admission numbers). No dedicated
`students.int.test.ts` file.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Created student missing from list | Default list hides `archived`; or caller is student/parent and the row isn't theirs | Pass `?status=archived`, or check `guardians`/`students.user_id` links |
| 403 on `GET /students/{id}` | Student/parent requesting a non-accessible id | Expected — owner scope; only staff see all |
| 409 / unique violation on enrol | Duplicate `admission_no` (manual value) | Omit `admissionNo` to use the sequence |
| Plan-limit error on enrol | Tenant at its plan student cap | Upgrade plan or archive inactive students |
| Attendance/fees vanished after delete | `hard=true` cascaded dependents | Use the default archive to retain history |

## 11. Future enhancement notes
- Promote legacy `authorize("admin")` gates to granular `students:*` permission
  keys for consistency with newer modules.
- Bulk import (CSV) of students; document attachments per student.
- Explicit guardian-management endpoints (currently linked via seed/portal).
- Dedicated `students.int.test.ts` covering update/archive/hard-delete paths.
