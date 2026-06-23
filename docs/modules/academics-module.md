# Academics Module

> **Status:** Implemented · **Backend:** `backend/src/modules/academics` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
The academic backbone: **academic years**, **classes** (grade levels) with
their **sections**, and the **subjects** catalogue. These records are
referenced by students, attendance, exams, fees, timetable and reports. See
*MODULE_WORKFLOWS.md §C — Academic setup*.

## 2. User roles involved
- **admin** — create/delete academic years, classes, sections, subjects.
- **teacher / accountant / student / parent** (any authenticated tenant user) —
  read academic years, classes (with sections + counts) and subjects.
- **super_admin** — platform role; not used for per-school academic setup.

## 3. Main screens / pages
- `/classes` — `frontend/src/app/(dashboard)/classes/page.tsx`: classes with
  their sections, student counts, and create/delete actions; subjects and
  academic-year management surface here too.

## 4. Main backend APIs
This router is mounted at `/api/v1/` (not under a `/academics` prefix), so its
paths are top-level. Guards are applied **per route** (`authenticate` +
`requireTenant`, plus `authorize("admin")` on writes).

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/academic-years` | List academic years (newest first) | Authenticated |
| POST | `/academic-years` | Create a year; `isCurrent=true` clears others | `authorize("admin")` |
| GET | `/classes` | List classes with sections + active student counts | Authenticated |
| POST | `/classes` | Create a class (`name`, `gradeLevel`) | `authorize("admin")` |
| DELETE | `/classes/{id}` | Delete a class (cascades to its sections) | `authorize("admin")` |
| POST | `/classes/{classId}/sections` | Add a section (name, optional homeroom teacher, capacity) | `authorize("admin")` |
| DELETE | `/sections/{id}` | Delete a section | `authorize("admin")` |
| GET | `/subjects` | List subjects (ordered by name) | Authenticated |
| POST | `/subjects` | Create a subject (`name`, `code`; code upper-cased) | `authorize("admin")` |
| DELETE | `/subjects/{id}` | Delete a subject | `authorize("admin")` |

Validation (`academics.schema.ts`): year requires `name`, `startDate`,
`endDate`; class requires `name` + `gradeLevel` (0–20); section requires
`name`, optional `homeroomTeacherId`/`capacity` (default 40); subject requires
`name` + `code`.

> There is **no `PATCH`/update endpoint** for these entities — create + delete only.

## 5. Database tables / entities
- **academic_years** (`0002_academics.sql`): `name`, `start_date`, `end_date`,
  `is_current`.
- **classes**: `name`, `grade_level`.
- **sections**: `class_id`, `name`, `homeroom_teacher_id` (→ teachers),
  `capacity`; `UNIQUE (class_id, name)`; cascade-deletes with its class.
- **subjects**: `name`, `code` (unique).
- **class_subjects**: maps section ⇄ subject ⇄ teacher (`UNIQUE (section_id,
  subject_id)`). The table exists in schema but has **no dedicated CRUD
  endpoints in this module** (to confirm where it is managed — currently seed
  data / used by other read surfaces).

All gained `institution_id` in `0013/0014` and are tenant-scoped at the
service layer.

## 6. Permissions / RBAC involved
Legacy role gating only: writes are `authorize("admin")`; reads are open to any
authenticated tenant user. No granular `academics:*` permission keys are
enforced on these routes.

## 7. Tenant isolation notes
Every list/create/delete passes `tenantId(req)` and filters/stamps
`institution_id`. The router uses **per-route** guards (not a router-level
`.use`) deliberately, because it is mounted at `/` alongside sibling routers
(e.g. super-admin `/institutions`); a blanket `.use` would wrongly intercept
those paths.

## 8. Key workflows
1. **Open an academic year.** Admin POSTs `/academic-years`; setting
   `isCurrent=true` runs in a transaction that first unsets the previous
   current year for the tenant.
2. **Build the class tree.** Create a class, then add sections under it
   (`/classes/{classId}/sections`), optionally assigning a homeroom teacher.
3. **List classes for enrolment.** `GET /classes` returns each class with its
   sections and a live count of active students per section (used by the
   students/attendance UIs).
4. **Maintain subjects.** Create subjects with an upper-cased `code`; referenced
   by exams, results and the timetable.
5. **Delete cascades.** Deleting a class removes its sections; sections/subjects
   are deleted directly (FK rules clear/restrict dependents accordingly).

## 9. Test coverage summary
No dedicated `academics.int.test.ts`. Class/section/subject creation is
exercised as setup fixtures across several suites (e.g. `college.int.test.ts`
hits `/classes`, and reports/timetable tests rely on sections/subjects). The
core read/create paths are therefore exercised via the integration suite, but
delete and academic-year flows lack a dedicated test.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 404 on `/academic-years` etc. for a sibling resource | Path collision expectation | Router is mounted at `/`; paths are top-level (`/classes`, not `/academics/classes`) |
| New year not marked current | `isCurrent` omitted/false | Pass `isCurrent: true`; it unsets the prior current year |
| Section create 404 | `classId` not in caller's tenant | Verify the class id and tenant |
| Cannot update a class/subject | No PATCH endpoint exists | Delete + recreate, or extend the module |
| `class_subjects` mapping not editable via API | No CRUD endpoint in this module | Manage via seed / pending feature (to confirm) |

## 11. Future enhancement notes
- Add `PATCH` (update) endpoints for years/classes/sections/subjects.
- Expose `class_subjects` CRUD (assign subject + teacher to a section).
- Promote write gates to granular `academics:*` permission keys.
- Term/semester structure already exists for college mode — unify the school
  and college academic models.
