# Homework & Assignments Module

> **Status:** Implemented · **Backend:** `backend/src/modules/homework` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

Lets teachers assign homework to a section + subject (with optional attachments
and a due date), notifies the section, lets students submit text and/or a file,
and lets teachers list and grade submissions. Students and parents see only the
homework for their own section(s); attachment downloads are permission-checked
and owner-scoped.

File storage and validation are shared with the [Documents module](./documents-file-uploads-module.md):
homework and submission attachments are rows in the `documents` table
(`owner_type` `homework`/`submission`) and are stored via the same S3-or-local
`storage` adapter.

## 2. User roles involved

| Role | Capability |
|------|-----------|
| `teacher` | Create/update/delete homework, add attachments, list submissions, review/grade |
| `admin` | Full homework access (all keys) |
| `student` | View homework for their section, submit (text/file), download attachments for their section/own submission |
| `parent` | View their children's section homework + monitor submissions (owner-scoped) |
| `accountant` | Read-only (per role matrix) |
| `super_admin` | Bypasses permission checks |

Staff vs portal access is decided by `accessibleStudentIds` → `accessibleSectionIds`:
staff are unrestricted (`null`); student/parent are restricted to the sections of
their accessible students.

## 3. Main screens / pages

- Staff/teacher web: `/homework` → `frontend/src/app/(dashboard)/homework/page.tsx`
  (create, assign, list submissions, mark/grade).
- Student/parent web: `/portal/homework` → `frontend/src/app/portal/homework/page.tsx`
  (list, submit, view attachments + grade).
- Mobile: `mobile/lib/screens/portal/homework_screen.dart` and
  `homework_detail_screen.dart` (list, detail, submission form + attachments).

## 4. Main backend APIs

Router — `backend/src/modules/homework/homework.routes.ts` (mounted under
`authenticate, requireTenant`). Uploads use `uploadSingle("file")`.

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/homework` | List homework (staff all; student/parent their sections); filters `sectionId`, `subjectId` | `homework:read` |
| POST | `/homework` | Create homework (section + subject + title …); notifies the section | `homework:create` |
| GET | `/homework/{id}` | Homework detail + attachments (+ a student's own submission inline) | `homework:read` |
| PATCH | `/homework/{id}` | Update homework | `homework:update` |
| DELETE | `/homework/{id}` | Delete homework | `homework:delete` |
| POST | `/homework/{id}/attachments` | Attach a file (multipart `file`) | `homework:update` |
| POST | `/homework/{id}/submit` | Student submits text (`content`) and/or a file; `late` if past due | `homework:submit` |
| GET | `/homework/{id}/submissions` | List submissions with student + status | `homework:review` |
| POST | `/homework/submissions/{sid}/review` | Review/grade (status, marks, remarks) | `homework:review` |
| GET | `/homework/attachments/{docId}/download` | Download a homework/submission attachment (owner-scoped) | `homework:read` |

Submission `status` enum: `submitted | reviewed | completed | late | resubmit`.

## 5. Database tables / entities

Migration `0020_homework.sql` (both tenant-scoped, `institution_id` NOT NULL):

- **`homework`** — `id`, `institution_id`, `section_id` → sections (CASCADE),
  `subject_id` → subjects (RESTRICT), `title`, `description`, `instructions`,
  `due_date` (DATE, nullable), `max_marks` (numeric, nullable), `created_by` →
  users (SET NULL), `created_at`/`updated_at`.
- **`homework_submissions`** — `id`, `institution_id`, `homework_id` → homework
  (CASCADE), `student_id` → students (CASCADE), `content`, `status`
  (default `submitted`, CHECK on the enum above), `marks`, `remarks`,
  `submitted_at`, `reviewed_at`, `reviewed_by` → users (SET NULL),
  `created_at`/`updated_at`; **UNIQUE `(homework_id, student_id)`** (a re-submit
  upserts the same row).
- **`documents`** — attachments, with `owner_type` = `homework` or `submission`
  and `owner_id` = the homework/submission id (see the Documents module).

## 6. Permissions / RBAC involved

Keys (seeded in `0020_homework.sql`): `homework:read`, `homework:create`,
`homework:update`, `homework:delete`, `homework:submit`, `homework:review`.
Seeded grants: admin = all; teacher = read/create/update/delete/review;
accountant = read; student = read + submit; parent = read.
`super_admin` bypasses checks in `requirePermission`.

## 7. Tenant isolation notes

- Every query filters by `institution_id`; references (section/subject) are
  validated against the tenant before insert (`assertRef`).
- List/detail are owner-scoped via `accessibleSectionIds(req, institutionId)`
  (built from `accessibleStudentIds`): staff get `null` (no filter); student/parent
  get only their accessible students' `section_id`s. A 403 is raised if a portal
  user requests homework outside their sections.
- **Submit** re-derives the student from `users.id` and rejects if the student's
  `section_id` does not match the homework's section.
- **Attachment download** (`downloadAttachment`) re-checks scope: for a
  `homework` attachment the homework's section must be accessible; for a
  `submission` attachment the submission's `student_id` must be in the caller's
  accessible set. Storage keys are never returned — only bytes are streamed.

## 8. Key workflows

1. **Assign:** teacher `POST /homework` (section, subject, title, optional
   due date/instructions/max marks). The service inserts the row, then awaits an
   in-app fan-out to the section (students + guardians) via the communication
   service and best-effort external channels; a notify failure never fails
   creation.
2. **Attach:** teacher `POST /homework/{id}/attachments` (multipart) — file is
   validated and stored as a `documents` row.
3. **Submit:** student `POST /homework/{id}/submit` with `content` and/or a file.
   Past the due date the status becomes `late`. The submission upserts on
   `(homework_id, student_id)`; the teacher (homework creator) is notified
   best-effort.
4. **Review:** teacher `GET /homework/{id}/submissions`, then
   `POST /homework/submissions/{sid}/review` with status + optional marks/remarks.
5. **Track:** parent/student monitor status and download attachments via the
   protected download route.

## 9. Test coverage summary

- Integration: `backend/tests/integration/homework.int.test.ts` — teacher creates
  homework targeting a section; section-scoped visibility for student/parent;
  student submission with a PDF attachment; teacher review (marks/remarks);
  owner-/section-scoped attachment download; role guards (student can't create,
  teacher can't submit, accountant read-only); cross-institution denial.
- Run via `npm run test:integration`.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Student gets 403 on submit | Student's `section_id` differs from the homework's section (or no student record for the account) | Confirm the student is enrolled in that section |
| Portal user sees no homework | Their accessible students have no `section_id`, or none assigned to that section | Ensure students have a section and homework targets it |
| Upload returns 503 | `storage.put` failed (S3 unreachable / disk error) | Check `STORAGE_*` config or local-dir permissions |
| Upload rejected (400) | File type/extension/size disallowed by `assertValidFile` | Use an allowed type (jpg/png/webp/gif/pdf) within `STORAGE_MAX_MB` |
| Attachment download 403 | Attachment's section/submission not in the caller's owner scope | Only the owning section/student (or staff) may download |
| Section not notified | Notify is best-effort and logged on failure | Check communication service logs; creation still succeeds |

## 11. Future enhancement notes

- A dedicated frontend Homework admin page was originally a Phase C planned item
  (UI_PAGES) and is now implemented; resubmission flows (`resubmit` status) and
  richer rubric grading could be expanded.
- Multiple attachments per submission are supported by the schema (no unique
  constraint on attachments); UI affordances for many files could be added.
