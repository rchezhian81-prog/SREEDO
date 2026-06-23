# Timetable Module

> **Status:** Implemented · **Backend:** `backend/src/modules/timetable` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose
Builds and serves the weekly class timetable. Maintains a **period master** and
a **room master**, then composes per-section **entries** (section × day ×
period → subject + optional teacher + room) with **clash detection** for
section, teacher and room, and a CSV export. See *MODULE_WORKFLOWS.md §K —
Timetable*.

## 2. User roles involved
Access is driven entirely by granular `timetable:*` permission keys (seeded in
`0015`):
- **admin** — full control: read, create, update, delete, export.
- **teacher** — `timetable:read` + `timetable:export` (view/print).
- **accountant / student / parent** — `timetable:read` (read-only).

## 3. Main screens / pages
- `/timetable` — `frontend/src/app/(dashboard)/timetable/page.tsx` with
  `classes/`, `teachers/` (class- and teacher-view grids) and `setup/`
  (period & room masters) subpages.

## 4. Main backend APIs
Base path `/api/v1/timetable`; router requires `authenticate` +
`requireTenant`, then per-route `requirePermission(...)`.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/timetable/periods` | List the period master | `timetable:read` |
| POST | `/timetable/periods` | Create a period | `timetable:create` |
| PATCH | `/timetable/periods/{id}` | Update a period | `timetable:update` |
| DELETE | `/timetable/periods/{id}` | Delete a period (cascades to entries) | `timetable:delete` |
| GET | `/timetable/rooms` | List the room master | `timetable:read` |
| POST | `/timetable/rooms` | Create a room | `timetable:create` |
| PATCH | `/timetable/rooms/{id}` | Update a room | `timetable:update` |
| DELETE | `/timetable/rooms/{id}` | Delete a room (cleared from entries) | `timetable:delete` |
| GET | `/timetable/entries` | List entries (filter `sectionId`/`teacherId`/`roomId`/`dayOfWeek`) | `timetable:read` |
| POST | `/timetable/entries` | Create an entry (rejects clashes, 409) | `timetable:create` |
| PATCH | `/timetable/entries/{id}` | Update an entry (re-checks clashes) | `timetable:update` |
| DELETE | `/timetable/entries/{id}` | Delete an entry | `timetable:delete` |
| GET | `/timetable/export` | CSV export for a class or teacher | `timetable:export` |

Validation (`timetable.schema.ts`): times match `HH:MM` (24h); `dayOfWeek`
1–7 (1=Monday … 7=Sunday); entry requires `sectionId`, `dayOfWeek`,
`periodId`, `subjectId`, with nullable `teacherId`/`roomId`.

## 5. Database tables / entities
- **periods** (`0015_timetable.sql`): `name`, `start_time`, `end_time`,
  `sort_order`, `is_break`; `UNIQUE (institution_id, name)`.
- **rooms**: `name`, `code`, `capacity`, `building`; `UNIQUE (institution_id, code)`.
- **timetable_entries**: `section_id`, `day_of_week`, `period_id`,
  `subject_id`, `teacher_id?`, `room_id?`. Clash prevention is enforced both in
  the service (friendly 409s) **and** by partial unique indexes:
  - `(institution_id, section_id, day_of_week, period_id)` — one entry per section slot;
  - `(institution_id, teacher_id, day_of_week, period_id)` where teacher set — no teacher double-booking;
  - `(institution_id, room_id, day_of_week, period_id)` where room set — no room double-booking.

## 6. Permissions / RBAC involved
Fully on granular keys: `timetable:read`, `timetable:create`,
`timetable:update`, `timetable:delete`, `timetable:export` (no legacy role
gates). Grants per `0015`: admin all; teacher read+export; accountant/student/
parent read.

## 7. Tenant isolation notes
Every period/room/entry query and mutation filters/stamps `institution_id`
(supplied by `tenantId(req)`), and the unique indexes are tenant-scoped.
Cross-tenant access is rejected (verified by `timetable.int.test.ts`).

## 8. Key workflows
1. **Set up masters.** A `timetable:create` holder defines periods (with
   sort order and break flags) and rooms once per institution.
2. **Place an entry.** `POST /timetable/entries` assigns a subject (and
   optionally a teacher/room) to a section's day+period; the service rejects a
   clash with a 409 before the DB index would, returning a friendly message.
3. **Edit safely.** `PATCH` re-runs the same conflict checks against the target
   slot.
4. **View grids.** Filter `/entries` by `sectionId` (class view), `teacherId`
   (teacher view) or `roomId`; results include subject/teacher/room/period names.
5. **Export.** `GET /timetable/export?sectionId=…` or `?teacherId=…` streams a
   `text/csv` attachment (`timetable.csv`).
6. **Delete cascades.** Deleting a period cascades to its entries; deleting a
   room clears it from entries.

## 9. Test coverage summary
Dedicated, thorough coverage in `timetable.int.test.ts`: create + list-with-
names, section/teacher/room double-booking prevention, allowing the same
teacher/room in a different period, conflict re-check on update, tenant
isolation, and permission enforcement (teacher is read-only).

## 10. Common troubleshooting
| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| 409 on create/update | Section/teacher/room already booked in that day+period | Pick a free slot or clear the conflicting entry |
| 409 creating a period/room | Duplicate name (period) or code (room) per tenant | Use a unique name/code |
| Teacher gets 403 on create | Teacher has read+export only | Use admin for edits |
| Export returns nothing useful | No `sectionId`/`teacherId` filter, or empty grid | Pass a filter; ensure entries exist |
| Day mapping off by one | `dayOfWeek` is 1=Mon … 7=Sun | Use the 1–7 convention |

## 11. Future enhancement notes
- Substitution / cover scheduling when a teacher is on leave (ties into staff-leave).
- Bulk grid editor and copy-week/template features.
- PDF (not just CSV) export and printable per-teacher timetables.
- Period-level attendance linkage (see Attendance module enhancements).
