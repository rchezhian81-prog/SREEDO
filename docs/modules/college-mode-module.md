# College Mode Module

> **Status:** Implemented · **Backend:** `backend/src/modules/college` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

Adds higher-education structure on top of the school ERP so a single tenant can
run as a **college**. An institution's `type` is switchable between `school` and
`college`; in college mode the tenant manages **departments → programs/courses →
semesters → enrollments**, plus academic **batches**, program-to-subject mappings
(with credits), and teacher **staff allocations**. It also provides the GPA/CGPA
foundation: semester and cumulative grade-point computation from semester-tagged
exam results against the institution's grade bands.

School mode is unaffected — existing school endpoints keep working, and college
overview simply reports an empty structure for a school.

## 2. User roles involved

- **admin** — full college control, including switching the institution `type`.
- **teacher** — read-only structure (overview, departments, programs, semesters);
  cannot create or change mode (403). Can be a department head / allocation
  target.
- **accountant** — read-only structure access.
- **student / parent** — no general college access (403), **except** the
  owner-scoped result endpoints: a student may read their own semester result /
  CGPA, a parent their linked child's.
- **super_admin** — bypasses permission checks (tenant-scoped routes still apply).

## 3. Main screens / pages

Under `frontend/src/app/(dashboard)/college/`:

- `page.tsx` — college overview (type + structure counts, mode switch).
- `departments/page.tsx`, `programs/page.tsx`, `semesters/page.tsx`,
  `subjects/page.tsx` (program subjects), `enrollments/page.tsx`,
  `results/page.tsx` (GPA/CGPA).

## 4. Main backend APIs

All under `/api/v1/college`, guarded by `authenticate` + `requireTenant`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/college/overview` | Type + structure counts | `college:read` |
| PATCH | `/college/settings` | Switch own institution school↔college | `college:update` |
| GET | `/college/departments` | List departments (head teacher + program counts) | `departments:read` |
| POST | `/college/departments` | Create a department | `departments:create` |
| PATCH | `/college/departments/{id}` | Update a department | `college:update` |
| DELETE | `/college/departments/{id}` | Delete a department (cascades to programs) | `college:delete` |
| GET | `/college/programs` | List programs/courses (optional `departmentId`) | `programs:read` |
| POST | `/college/programs` | Create a program/course | `programs:create` |
| PATCH | `/college/programs/{id}` | Update a program | `college:update` |
| DELETE | `/college/programs/{id}` | Delete a program (cascades to semesters/enrollments) | `college:delete` |
| GET | `/college/semesters` | List semesters (optional `programId`) | `semesters:read` |
| POST | `/college/semesters` | Create a semester | `semesters:create` |
| PATCH | `/college/semesters/{id}` | Update a semester | `college:update` |
| DELETE | `/college/semesters/{id}` | Delete a semester | `college:delete` |
| GET | `/college/batches` | List academic batches (optional `programId`) | `college:read` |
| POST | `/college/batches` | Create a batch | `college:create` |
| DELETE | `/college/batches/{id}` | Delete a batch | `college:delete` |
| GET | `/college/program-subjects` | List subject↔program/semester mappings (credits) | `college:read` |
| POST | `/college/program-subjects` | Map a subject to a program (+ semester) with credits | `college:create` |
| DELETE | `/college/program-subjects/{id}` | Remove a mapping | `college:delete` |
| GET | `/college/enrollments` | List enrollments (filter program/semester) | `college:read` |
| POST | `/college/enrollments` | Enroll a student into a program (+ semester/batch) | `college:create` |
| PATCH | `/college/enrollments/{id}` | Promote semester / change batch / status | `college:update` |
| DELETE | `/college/enrollments/{id}` | Delete an enrollment | `college:delete` |
| GET | `/college/staff-allocations` | List teacher allocations | `college:read` |
| POST | `/college/staff-allocations` | Allocate a teacher to dept/program/subject | `college:create` |
| DELETE | `/college/staff-allocations/{id}` | Remove an allocation | `college:delete` |
| GET | `/college/students/{studentId}/semesters/{semesterId}/result` | Semester result (subject + semester GPA) — owner-scoped | (route-level owner scope) |
| GET | `/college/students/{studentId}/cgpa?programId=` | Cumulative GPA across a program — owner-scoped | (route-level owner scope) |

> The two result endpoints have no `requirePermission` guard; access is controlled
> by `accessibleStudentIds` + `assertStudentAccess` so a student/parent reaches
> only their own / linked-child results, while staff (unrestricted scope) reach any.

## 5. Database tables / entities

All tenant-scoped (`institution_id`), migration `0023_college_mode.sql`:

- **`departments`** — `name`, `code` (unique per tenant), `head_teacher_id`.
- **`programs`** — `department_id`, `name`, `code` (unique), `duration_semesters`
  (default 6).
- **`semesters`** — `program_id`, `name`, `number` (unique per program),
  `academic_year_id`, `start_date`, `end_date`.
- **`program_subjects`** — `program_id`, optional `semester_id`, `subject_id`,
  `credits` (default 3); a subject is unique per semester mapping.
- **`enrollments`** — `student_id`, `program_id`, optional `semester_id` /
  `batch_id`, `status` (default `active`); a student is unique per program.
- **`batches`** — `program_id`, `name`, `start_year`; unique per program.
- **`staff_allocations`** — `teacher_id` + at least one of
  `department_id` / `program_id` / `subject_id`.

Reused tables: `institutions.type` (the mode flag), `subjects`, `students`,
`teachers`, `exams` (`semester_id`-tagged), `exam_results`, and `grade_bands`
(grade → percent range → grade point) for GPA/CGPA.

## 6. Permissions / RBAC involved

Seeded in `0023_college_mode.sql`: `college:read`, `college:create`,
`college:update`, `college:delete`, `departments:read`, `departments:create`,
`programs:read`, `programs:create`, `semesters:read`, `semesters:create`. Default
grants: **admin** receives all college/dept/program/semester keys; **teacher** and
**accountant** receive the read keys only (`college:read`, `departments:read`,
`programs:read`, `semesters:read`). Create routes for departments/programs/
semesters use the granular `:create` keys; updates/deletes use the broad
`college:update` / `college:delete`.

## 7. Tenant isolation notes

Every list/create/update/delete filters on `institution_id` from `tenantId(req)`,
and all foreign-key references are validated against the same tenant via
`assertRef` (e.g. a program's department, an enrollment's student/program, an
allocation's teacher) — so you cannot attach a record to another tenant's entity.
Cross-tenant update/delete returns 404 (the row isn't visible). The mode switch
(`setInstitutionType`) touches only the caller's own `institution_id`, so a tenant
admin can enable college features without the super-admin console. Result
endpoints add owner-scoping on top. Verified in tests: two colleges see only their
own departments and 404 on each other's records.

## 8. Key workflows

1. **Enable college mode** — admin `PATCH /college/settings { type: "college" }`
   (own tenant only).
2. **Build the structure** — create department → program (under a department) →
   semester (under a program) → batch; map subjects to a program/semester with
   credits; enroll students; allocate teachers.
3. **Promote / change status** — `PATCH /college/enrollments/{id}` updates the
   semester, batch, or status.
4. **GPA / CGPA** — `semesterResult` averages each subject's percentage across its
   exam rows, maps to a grade point via `grade_bands`, and credit-weights into a
   semester GPA; `cgpa` aggregates across the program's semesters. Owner-scoped
   for student/parent reads.
5. **Overview** — `GET /college/overview` returns the institution type and counts
   of departments/programs/semesters/enrollments.

## 9. Test coverage summary

`backend/tests/integration/college.int.test.ts` covers: end-to-end structure
build + overview + department head/program-count resolution; duplicate rejection
(409) and reference validation (400 for a non-existent department); GPA/CGPA
computation from semester-tagged exam results (e.g. `(4*10 + 3*8)/7 → 9.14`);
**owner-scoped result/CGPA reads** (student/parent own/child 200, others 403);
permission guards (teacher reads but cannot create or switch mode; accountant
read-only; student no access; admin full incl. mode switch); tenant scoping (no
cross-institution access, 404 on the other tenant's records); and a no-regression
check that school mode still works and a school can opt into college mode for its
own tenant.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Create returns 400 "Invalid department/program/…" | Referenced entity belongs to another tenant or doesn't exist | Reference only entities in the same institution |
| Create returns 409 | Duplicate code / semester number / batch / enrollment / subject mapping | Use a unique code/number; a student can enroll in a program once |
| Teacher gets 403 creating a department | Teacher has read-only college access | Have an admin create it, or grant `departments:create` via the RBAC console |
| Student gets 403 on `/college/overview` | Students have no general college access | Expected; students use only the owner-scoped result endpoints |
| Result GPA is null | No grade bands seeded, or no semester-tagged exam results | Seed `grade_bands`; tag exams with `semester_id` and record results |
| Cross-tenant update/delete returns 404 | Tenant isolation | Expected; operate only within the owning tenant |

## 11. Future enhancement notes

- Course/credit prerequisites and graduation-requirement checks.
- Elective vs core subject handling within `program_subjects`.
- Transcript PDF generation from CGPA (would reuse the `pdfs/` module).
- Bulk semester promotion across an enrolled cohort.
- Items marked "(to confirm)": none — behaviour maps to `college.routes.ts`,
  `college.service.ts`, `college.schema.ts`, and the integration test.
