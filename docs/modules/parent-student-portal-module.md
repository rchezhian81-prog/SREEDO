# Parent & Student Portal Module

> **Status:** Implemented · **Backend:** `backend/src/modules/portal` (+ `backend/src/modules/auth`) · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The portal is the self-service surface for **students** and **parents** (web at
`frontend/src/app/portal/*` and the Flutter mobile app). It exposes a read-mostly
view of a student's own school life: profile, attendance, fees (including online
payment + receipt), exam report cards, timetable, announcements/inbox, homework,
documents, transfer certificates and (when enabled) disciplinary records.

Every portal request is **owner-scoped**: a student sees only their own record; a
parent sees only the children linked to them in the `guardians` table. Staff do
not use the portal — they use the main dashboard with Bearer-token auth.

The `portal` module itself is thin: it provides the child selector, a combined
student summary, and the student timetable, and delegates feature data to the
existing feature modules (fees, attendance, exams/reports, homework, documents,
communication, disciplinary), each of which re-applies owner-scoping.

## 2. User roles involved

| Role | Access |
|------|--------|
| `student` | Own record only (`accessibleStudentIds` → their single linked student id) |
| `parent` | Their linked children only (`guardians` rows for the parent's user id) |
| Staff (`admin`/`teacher`/`accountant`) | **Not** served by the portal router — blocked at `/auth/portal/login` and by `authorize("student","parent")` on `/portal/*` |
| `super_admin` | Cross-tenant; not a portal user |

## 3. Main screens / pages

Web (Next.js, base route `frontend/src/app/portal`):

| Page | Route | File |
|------|-------|------|
| Portal login | `/portal/login` | `frontend/src/app/portal/login/page.tsx` |
| Portal home / dashboard | `/portal` | `frontend/src/app/portal/page.tsx` |
| Profile (+ ID card download) | `/portal/profile` | `frontend/src/app/portal/profile/page.tsx` |
| Attendance summary | `/portal/attendance` | `frontend/src/app/portal/attendance/page.tsx` |
| Timetable | `/portal/timetable` | `frontend/src/app/portal/timetable/page.tsx` |
| Report cards (by exam) | `/portal/reports` | `frontend/src/app/portal/reports/page.tsx` |
| Documents (upload/download) | `/portal/documents` | `frontend/src/app/portal/documents/page.tsx` |
| Certificates (TC download) | `/portal/certificates` | `frontend/src/app/portal/certificates/page.tsx` |
| Homework (list + submit) | `/portal/homework` | `frontend/src/app/portal/homework/page.tsx` |
| Disciplinary (when enabled) | `/portal/disciplinary` | `frontend/src/app/portal/disciplinary/page.tsx` |
| Fees (invoices, pay online, receipt) | `/portal/fees` | `frontend/src/app/portal/fees/page.tsx` |
| Announcements / notices | `/portal/announcements` | `frontend/src/app/portal/announcements/page.tsx` |
| Inbox (messages from school) | `/portal/inbox` | `frontend/src/app/portal/inbox/page.tsx` |
| Messages (two-way threads) | `/portal/messages` | `frontend/src/app/portal/messages/page.tsx` |

Mobile (Flutter, `mobile/lib/screens/portal/*`): login, portal home,
attendance, fees (with online payment), homework + homework detail, notices,
inbox, documents, reports, profile. Child selection is handled by a
`PortalProvider`. The web app keeps portal state in
`frontend/src/stores/portal-store.ts` (Zustand): it holds `user`, `children`,
and `selectedStudentId`; logs in via `POST /auth/portal/login`; relies on the
httpOnly cookies (all requests use `credentials: "include"`, no Bearer token);
auto-refreshes via `POST /auth/portal/refresh` on a 401 (single-flight); persists
only `user` + `selectedStudentId` to localStorage.

## 4. Main backend APIs

Portal data router — `backend/src/modules/portal/portal.routes.ts`. All
endpoints are mounted under `authenticate, requireTenant, authorize("student","parent")`.

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/portal/children` | Students the caller may view (self for student, children for parent) — compact cards | role gate (`student`/`parent`) + owner-scope |
| GET | `/portal/students/{studentId}/summary` | Profile + attendance + fee summary for an accessible student | role gate + `assertStudentAccess` |
| GET | `/portal/students/{studentId}/timetable` | The student's section timetable | role gate + `assertStudentAccess` |
| GET | `/portal/students/{studentId}/disciplinary` | Owner-scoped disciplinary records (only if the institution enabled portal visibility) | `disciplinary:portal_read` + `assertStudentAccess` |

Auth (portal-cookie flow) — `backend/src/modules/auth/auth.routes.ts`:

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| POST | `/auth/portal/login` | Student/parent login; rejects staff (403, refresh revoked); sets httpOnly cookies; returns `{ user }` | public (rate-limited) |
| POST | `/auth/portal/refresh` | Rotate the session from the refresh cookie; clears cookies on failure | refresh cookie |
| POST | `/auth/portal/logout` | Revoke the session + clear cookies | refresh cookie |
| GET | `/auth/me` | Authenticated profile | authenticated |

Feature data the portal links into (each owner-scoped in its own module):
fees + online payments + receipt (`/online-payments`, `/fees`), attendance,
exams report cards (`GET /reports/report-card?examId&studentId` — staff any,
student/parent own/linked), homework (`/homework`), documents (`/documents`),
announcements + messages (`/communication`). See the per-module docs for the
exact endpoints.

## 5. Database tables / entities

- **`guardians`** (migration `0016_guardians.sql`) — links a parent `user_id` to a
  `student_id` with a `relationship`; `institution_id` NOT NULL; UNIQUE
  `(user_id, student_id)`. This is the parent→children mapping.
- **`students.user_id`** (migration `0002_academics.sql`) — a student's own login
  account (UNIQUE, `ON DELETE SET NULL`). This is the student→self mapping.
- The portal **reads** from feature tables — `attendance_records`, `invoices`,
  `payments`, `exam_results`, `timetable_entries`, `documents`, `homework`,
  `messages`/`message_recipients`, `disciplinary_records` — always filtered by
  `institution_id` and owner scope. It owns no tables of its own.

## 6. Permissions / RBAC involved

- The `/portal/*` data router is gated by **role** (`authorize("student","parent")`),
  not by `module:action` keys — students/parents are not granted staff permission
  keys.
- The one exception is the disciplinary portal route, which additionally requires
  the `disciplinary:portal_read` permission (held by student/parent) **and** the
  institution feature flag enabling portal visibility (default OFF).
- Owner-scoping (below) is the real authorization gate; the role gate only ensures
  the caller is a portal user.

## 7. Tenant isolation notes

- `requireTenant`/`tenantId(req)` supply the caller's `institution_id`; every
  portal query filters on it (e.g. `WHERE s.institution_id = $1 AND s.id = ANY($2)`).
- **Owner-scoping** is implemented in `backend/src/utils/scope.ts`:
  - `accessibleStudentIds(req)` returns `null` for staff (unrestricted), the
    single linked id for a `student`, or the array of linked child ids for a
    `parent` (via `guardians`). An empty array means "no linked records".
  - `assertStudentAccess(allowed, studentId)` throws 403 unless `allowed` is
    `null` or contains the requested id.
- Cross-institution access is denied because a student/child id from another
  tenant will neither match the `institution_id` filter nor appear in
  `accessibleStudentIds`.
- Cookies are `httpOnly`, `SameSite=Lax`, `path=/`, and `Secure` in production
  (`backend/src/utils/cookies.ts`); max-age tracks `JWT_REFRESH_TTL_DAYS`.

## 8. Key workflows

1. **Login:** student/parent submits email + password to `POST /auth/portal/login`.
   The service authenticates; if the role is not `student`/`parent` the refresh
   token is revoked and a 403 is returned (staff must use `/auth/login`). On
   success the access + refresh tokens are set as httpOnly cookies and `{ user }`
   is returned.
2. **Pick a child:** the portal calls `GET /portal/children`; a parent with
   several children selects one (`selectedStudentId`); a student has exactly one.
3. **View summary:** `GET /portal/students/{id}/summary` returns profile +
   attendance (counts + rate) + fees (due/paid/outstanding/pending invoices) for
   one accessible student.
4. **Drill into features:** the UI links to attendance, fees (and pays online +
   downloads the receipt PDF), report cards, timetable, homework (view + submit),
   documents, announcements/inbox, certificates and (if enabled) disciplinary —
   each enforcing the same owner scope server-side.
5. **Session upkeep:** on a 401 the client calls `POST /auth/portal/refresh` to
   rotate cookies; logout hits `POST /auth/portal/logout`.

## 9. Test coverage summary

- Integration: `backend/tests/integration/portal.int.test.ts` — portal cookie
  login (and staff rejection), cookie-only auth, refresh rotation, logout,
  student-self vs parent-children scoping, cross-institution denial, and the
  attendance/fees/timetable views.
- Auth: `backend/tests/integration/auth.int.test.ts` — core login, Bearer
  protected routes, invalid credentials, refresh rotation with reuse detection.
- Run via `npm run test:integration` (Supertest against a real Postgres from
  `DATABASE_URL`; migrations applied automatically). `npm test` is unit-only.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| Staff account gets 403 at `/auth/portal/login` | Portal login intentionally rejects non-student/parent roles | Use the staff Bearer flow `POST /auth/login` |
| Portal requests 401 even after login | Cookies not sent (missing `credentials: "include"`) or cross-site over plain HTTP | Ensure same-site requests; in production serve over HTTPS (cookies are `Secure`) |
| `GET /portal/children` returns `[]` | No `guardians` rows for a parent, or `students.user_id` not linked for a student | Link the parent in `guardians` / set the student's `user_id` |
| 403 on `/portal/students/{id}/...` | Requested student isn't in the caller's accessible set | Confirm the id belongs to the caller's child/self in this tenant |
| Disciplinary tab 403 | Portal visibility flag off, or `disciplinary:portal_read` not granted | Admin enables visibility via `PATCH /disciplinary/settings`; grant the permission |

## 11. Future enhancement notes

- Push notifications: mobile obtains an FCM token but backend device registration
  is pending (see UI_PAGES §5). `FCM_SERVER_KEY` is optional.
- The expanded role set (Principal, Office Staff, etc.) in
  ROLES_AND_PERMISSIONS is planned; portal scoping is the foundation for issuing
  more granular logins.
- Two-way messaging exists; richer parent↔teacher communication and live
  transport tracking are roadmap items.
