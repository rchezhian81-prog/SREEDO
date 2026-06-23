# Attendance Module

> **Status:** Implemented · **Backend:** `backend/src/modules/attendance` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
Daily **student** attendance: staff fetch the active roster for a date/section,
mark statuses in bulk (idempotent upsert), and view per-student history with a
status summary. One record per student per day. See *MODULE_WORKFLOWS.md §F —
Daily attendance*. (Staff/employee attendance is a separate module under
`/api/v1/staff`.)

## 2. User roles involved
- **admin, teacher** — mark attendance (`POST`).
- **admin, teacher, accountant** (staff) — view the section roster (`GET /attendance`).
- **student** — view **only their own** history.
- **parent** — view **only their linked children's** history.

The date roster (`GET /attendance`) is staff-only via `requireStaff(req)`;
single-student history is owner-scoped via `assertStudentAccess()`.

## 3. Main screens / pages
- `/attendance` — `frontend/src/app/(dashboard)/attendance/page.tsx`: pick a
  date and section, load the roster, set present/absent/late/excused per
  student and submit in one bulk call.

## 4. Main backend APIs
Base path `/api/v1`. All routes require `authenticate` + `requireTenant`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/attendance` | Active students + their status for a `date` (default today), optional `sectionId` | `requireStaff` (staff only) |
| POST | `/attendance` | Bulk mark for a `date`; idempotent upsert keyed on (student, date) | `authorize("admin", "teacher")` |
| GET | `/attendance/students/{studentId}` | One student's records + per-status summary; optional `from`/`to` range | Authenticated + `assertStudentAccess()` (owner-scoped) |

Validation (`attendance.schema.ts`): `status ∈ {present, absent, late,
excused}`; bulk `records` array 1–500 items; `date` ISO date; optional
`remarks ≤ 500` chars.

> Note: the seed catalogue defines `attendance:read` / `attendance:mark`
> permission keys, but these routes enforce access via the legacy
> `requireStaff` / `authorize(...)` gates rather than `requirePermission`.

## 5. Database tables / entities
- **attendance_records** (`0003_attendance.sql`; tenant column added in
  `0013/0014`): `student_id`, `date`, `status` (enum `attendance_status`),
  `remarks`, `marked_by` (→ users). **UNIQUE (student_id, date)** powers the
  idempotent upsert. Indexed on `date` and `student_id`. Rows cascade-delete
  with their student.

## 6. Permissions / RBAC involved
Legacy gating: marking requires the `admin` or `teacher` role; the roster read
requires any staff role; per-student history is open to authenticated callers
but row-filtered by owner scope. Granular `attendance:read`/`attendance:mark`
keys exist in the catalogue for future migration.

## 7. Tenant isolation notes
The roster query joins students filtered by `s.institution_id`; the upsert
stamps `institution_id`; history filters by `institution_id`. A
student/parent only ever resolves to ids inside their own tenant via
`accessibleStudentIds()`.

## 8. Key workflows
1. **Load the roster.** Staff `GET /attendance?sectionId=…&date=…`. Returns all
   **active** students (left-joined to any existing record for that date) so the
   UI shows current marks.
2. **Bulk mark.** `POST /attendance` with `{ date, records: [{ studentId,
   status, remarks? }] }`. Each row upserts via `ON CONFLICT (student_id, date)
   DO UPDATE`, so re-submitting the same date safely overwrites — never
   duplicates. Runs in a single transaction; returns `{ date, upserted }`.
3. **Per-student history.** `GET /attendance/students/{id}?from=…&to=…` returns
   ordered records plus a `{status: count}` summary. Students/parents are
   restricted to their own/children's ids.

## 9. Test coverage summary
The `/attendance` endpoint is exercised by the OpenAPI contract smoke test
(`contract.int.test.ts`) and indirectly by access/isolation fixtures. There is
no dedicated `attendance.int.test.ts`; the bulk-upsert and history paths are
not covered by a dedicated suite.

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 403 on `GET /attendance` | Caller is student/parent | Roster is staff-only; use `/attendance/students/{id}` |
| Student absent from roster | `status <> 'active'` | Only active students appear; re-activate or check status |
| Re-marking didn't duplicate (expected new row) | Upsert is keyed on (student, date) | By design — same date overwrites the prior mark |
| Bulk call rejected | >500 records, or invalid `status`/`date` | Split into ≤500-record batches; use enum values |
| Parent sees no history | No `guardians` link to that child | Add the parent⇄child link |

## 11. Future enhancement notes
- Migrate to granular `attendance:read`/`attendance:mark` permission keys.
- Period/subject-level attendance (currently one mark per day).
- Absence-alert automation already exists as a background job
  (`absence_alert_sweep`); surface its configuration in this module's UI.
- Attendance analytics / export and biometric or QR check-in integration.
