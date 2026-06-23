# Discipline Records Module

> **Status:** Implemented · **Backend:** `backend/src/modules/disciplinary` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

A behavioural-incident register for schools and colleges. Staff log incidents
against a student (with category, severity, description, reporter, involved
staff), then drive each record through a lifecycle —
`open → under_review → action_taken → closed` (or `cancelled`) — while every
transition is appended to an immutable per-record action timeline. The module
snapshots the student's identity at creation time, and includes a per-institution
**portal-visibility toggle** that controls whether students/parents can see their
own / linked-child records in the portal (OFF by default).

## 2. User roles involved

- **admin** — full disciplinary control (all `disciplinary:*` keys).
- **teacher** — log, read, update, action, and view reports; **cannot** close,
  cancel, or delete (those return 403).
- **accountant** — no disciplinary permissions (403 on the admin register).
- **student / parent** — only `disciplinary:portal_read`, and only via the portal
  endpoint, owner-scoped, and only when the institution has enabled portal
  visibility. They can never reach the admin register.
- **super_admin** — bypasses permission checks (tenant-scoped routes still apply).

## 3. Main screens / pages

- `/disciplinary` — incident register (filter by status/severity/category/date,
  search). `frontend/src/app/(dashboard)/disciplinary/page.tsx`.
- `/disciplinary/new` — log a new incident.
- `/disciplinary/[id]` — record detail: lifecycle actions + action timeline.
- `/disciplinary/reports` — disciplinary reports view.
- **Portal:** `frontend/src/app/portal/disciplinary/page.tsx` (only renders data
  when the institution has enabled the portal toggle).

## 4. Main backend APIs

All under `/api/v1` and guarded by `authenticate` + `requireTenant`. The portal
read lives in the portal module.

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/disciplinary` | Incident register (filterable) | `disciplinary:read` |
| POST | `/disciplinary` | Log an incident (snapshots the student) | `disciplinary:create` |
| GET | `/disciplinary/settings` | Read portal-visibility flag | `disciplinary:read` |
| PATCH | `/disciplinary/settings` | Enable/disable portal visibility | `disciplinary:update` |
| GET | `/disciplinary/student/{studentId}` | A student's disciplinary history | `disciplinary:read` |
| GET | `/disciplinary/{id}` | Record detail | `disciplinary:read` |
| PATCH | `/disciplinary/{id}` | Edit a record (active records only) | `disciplinary:update` |
| DELETE | `/disciplinary/{id}` | Hard-delete a record (entered wrongly) | `disciplinary:delete` |
| GET | `/disciplinary/{id}/actions` | Audit timeline for a record | `disciplinary:read` |
| POST | `/disciplinary/{id}/review` | Move to `under_review` | `disciplinary:action` |
| POST | `/disciplinary/{id}/action` | Record action taken → `action_taken` | `disciplinary:action` |
| POST | `/disciplinary/{id}/close` | Close a record | `disciplinary:close` |
| POST | `/disciplinary/{id}/cancel` | Cancel a record (retained for audit) | `disciplinary:delete` |
| GET | `/portal/students/{studentId}/disciplinary` | Owner-scoped portal read (toggle-gated) | `disciplinary:portal_read` |

## 5. Database tables / entities

- **`disciplinary_records`** (PK `id`, tenant `institution_id`). Columns:
  `student_id`, snapshot columns (`admission_no`, `class_name`, `section_name`,
  `program_name`, `semester_name`), `incident_date`, `category`, `severity`
  (`low`/`medium`/`high`/`critical`), `description`, `reported_by`,
  `involved_staff`, `action_taken`, `follow_up_date`, `status`
  (`open`/`under_review`/`action_taken`/`closed`/`cancelled`), `remarks`,
  `closed_at`/`closed_by`, `cancelled_at`/`cancelled_by`/`cancel_reason`,
  `created_by`.
- **`disciplinary_actions`** (PK `id`, tenant `institution_id`,
  `record_id` → records, `ON DELETE CASCADE`). The append-only audit timeline:
  `action` (e.g. `logged`, `edited`, `review`, `action_taken`, `closed`,
  `cancelled`), `note`, `from_status`, `to_status`, `created_by`, `created_at`.

Migration `0037_disciplinary.sql`. The portal toggle is **not** a separate table —
it is stored on `institutions.settings → featureFlags → disciplinaryPortal`
(jsonb), read/written by `portalEnabled` / `setPortalSettings`.

## 6. Permissions / RBAC involved

Seeded in `0037_disciplinary.sql`:
`disciplinary:read`, `:create`, `:update`, `:delete`, `:action`, `:close`,
`:reports`, `:portal_read`.

Default grants: **admin** gets all keys; **teacher** gets
`read/create/update/action/reports` (not `close`, `delete`, or the toggle which
needs `update`); **student** and **parent** get `:portal_read` only.

## 7. Tenant isolation notes

Every register/detail/history/action query filters on `institution_id`. The
student-history and portal reads first confirm the student belongs to the tenant
(avoids cross-tenant probing). The portal read is doubly gated: the institution
must have `disciplinaryPortal` enabled **and** the caller may only request a
student id in their `accessibleStudentIds` set. Tests confirm a second
institution's admin sees zero records and 404 on detail/close/delete.

## 8. Key workflows

1. **Log incident** — `POST /` snapshots the student and writes a `logged` action
   (from `null` → `open`).
2. **Edit** — `PATCH /{id}` allowed only while the record is active; closed and
   cancelled records are immutable (returns 400). Each edit writes an `edited`
   action.
3. **Lifecycle** — `review` → `action` → `close`, each transition locked with
   `FOR UPDATE`, validated against the terminal-state guard, and appended to the
   timeline. `recordAction` also stores the `action_taken` text and optional
   follow-up date.
4. **Cancel vs delete** — `cancel` keeps the record (retained for audit, status
   `cancelled`); `delete` hard-removes it (for rows entered wrongly).
5. **Portal toggle** — admin flips `PATCH /settings { portalEnabled }`; until
   enabled, even the record owner gets 403 from the portal endpoint.

## 9. Test coverage summary

`backend/tests/integration/disciplinary.int.test.ts` covers: create + student
snapshot + initial `logged` trail; field updates; the full
review → action → close workflow with terminal-record immutability and a complete
action trail; cancel-and-retain; permission gating (teacher can log/act but not
close/cancel/delete; admin can hard-delete); staff student-history; the portal
default-OFF behaviour and owner-scoping once enabled (student sees own, parent
sees linked child, others 403); blocking students/parents/accountant from the
admin register; permission-gated disciplinary reports; and tenant isolation.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Portal shows no records to a parent who has them | Institution portal toggle is OFF (default) | Admin enables `PATCH /disciplinary/settings { portalEnabled: true }` |
| Edit/transition returns 400 "a closed/cancelled record cannot be modified" | Record is in a terminal state | Terminal records are immutable; cancel was intentional — create a new record |
| Teacher gets 403 on close/cancel/delete | Teacher lacks `disciplinary:close` / `:delete` | Have an admin perform it, or grant the key via the RBAC console |
| Accountant gets 403 on the register | Accountant has no `disciplinary:*` grants | Expected; grant explicitly if the institution wants accountant access |
| Cross-institution 404 on a known record id | Tenant isolation | Expected; access records only within the owning tenant |

## 11. Future enhancement notes

- Notify parents automatically when a record becomes portal-visible.
- Configurable category/severity taxonomies and merit/demerit points.
- Attachments (evidence) on records via the documents module.
- Items marked "(to confirm)": none — behaviour maps to
  `disciplinary.routes.ts` / `disciplinary.service.ts`, `portal.routes.ts`, and
  the integration test.
