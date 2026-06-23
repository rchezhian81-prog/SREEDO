# Communication & Notifications Module

> **Status:** Implemented · **Backend:** `backend/src/modules/communication` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Communication & Notifications module is the in-app messaging and alerting
hub. It provides:

- **Broadcast / targeted messages** — compose a message to an audience (all
  students, all parents, staff, a section, a class, a single student/parent/user)
  that lands in each recipient's inbox.
- **Inbox** — owner-scoped per recipient, with unread counts and read tracking.
- **Conversation threads** — one-to-one or group threads with replies,
  per-participant read state, archive, and add-participants (participant-scoped).
- **Device tokens** — register/unregister a device for push notifications.
- **Generated notifications** — fee reminders (to students with outstanding
  invoices and their guardians) and absence alerts (for a date's absentees,
  de-duplicated per student/date).

Every in-app message also triggers a **best-effort external fan-out** to email,
SMS, and push via `dispatchExternal`, which degrades gracefully when SMTP / SMS /
FCM are unconfigured and never fails the originating request.

Mounted at `/api/v1/communication` (see `backend/src/app.ts`).

> **Separate module — Announcements.** Public, non-inbox notice-board posts are a
> different module: `backend/src/modules/announcements/` (mounted at
> `/api/v1/announcements`, table `announcements`, gated by `authorize("admin",
> "teacher")` rather than a `communication:*` key). Frontend:
> `frontend/src/app/(dashboard)/announcements/`. Use Announcements for the notice
> board; use Communication for inbox messages, threads, and alerts.

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` / `teacher` / `accountant` | Compose messages, start/reply to threads, trigger fee/absence notifications (depends on granted keys). |
| `student` / `parent` | Receive inbox messages; read; register device tokens; participate in threads where added. (Thread creation is permission-gated — tests confirm students cannot start a thread.) |
| `super_admin` | Cross-tenant; bypasses permission checks. |

Inbox is owner-scoped to the caller; threads are participant-scoped (visible only
to participants).

## 3. Main screens / pages

Frontend route groups:

- `frontend/src/app/(dashboard)/communication/page.tsx` — messaging /
  notifications hub (compose, sent history, fee/absence triggers).
- `frontend/src/app/(dashboard)/messaging/page.tsx` — conversation threads.
- `frontend/src/app/(dashboard)/announcements/page.tsx` — the separate
  Announcements notice board (cross-linked above).

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/communication/inbox` | Caller's own inbox (owner-scoped) | `communication:read` |
| GET | `/communication/inbox/unread-count` | Caller's unread count | `communication:read` |
| POST | `/communication/inbox/:id/read` | Mark one message read | `communication:read` |
| GET | `/communication/messages` | Sent history (+ recipient/read counts) | `communication:create` |
| POST | `/communication/messages` | Compose & send to an audience | `communication:send` |
| DELETE | `/communication/messages/:id` | Delete a message (and recipients) | `communication:delete` |
| POST | `/communication/fee-reminders` | Send fee reminders (outstanding fees) | `notifications:send` |
| POST | `/communication/absence-alerts` | Send absence alerts for a date | `notifications:send` |
| POST | `/communication/device-tokens` | Register caller's push device token | Authenticated (no key) |
| DELETE | `/communication/device-tokens` | Remove caller's device token | Authenticated (no key) |
| GET | `/communication/threads` | List my threads (+ unread counts) | `threads:read` |
| POST | `/communication/threads` | Start a thread (direct or group) | `threads:create` |
| GET | `/communication/threads/unread-count` | Unread across my threads | `threads:read` |
| GET | `/communication/threads/:id` | Thread detail (participants + messages) | `threads:read` |
| DELETE | `/communication/threads/:id` | Archive the thread for me | `threads:delete` |
| POST | `/communication/threads/:id/messages` | Reply (notifies others) | `threads:reply` |
| POST | `/communication/threads/:id/read` | Mark thread read for me | `threads:read` |
| POST | `/communication/threads/:id/participants` | Add participants | `threads:manage` |

All routes require JWT Bearer + tenant context. Device-token routes are
authenticated but ungated by a permission key (caller manages their own token).

## 5. Database tables / entities

- `messages` — broadcast/targeted message header: `sender_id`, `category`
  (`message | announcement | general | fee_reminder | absence_alert`),
  `subject`, `body`, `audience_type`, `audience_ref`.
- `message_recipients` — per-recipient fan-out: `message_id`, `user_id`,
  `read_at`; unique per `(message_id, user_id)`; this is what powers the inbox.
- `threads` — conversation header: `subject`, `type` ∈ `direct | group`,
  `created_by`, `last_message_at`.
- `thread_messages` — replies within a thread: `thread_id`, `sender_id`, `body`.
- `thread_participants` — membership + read state: `thread_id`, `user_id`,
  `added_by`, `last_read_at`, `archived_at`; unique per `(thread_id, user_id)`.
- `device_tokens` — push tokens: `user_id`, `token` (unique), `platform`.
- `notification_log` — de-duplication ledger for generated notifications:
  `kind`, `dedupe_key` (unique per institution where not null), `channel`,
  `status` (used to suppress duplicate absence alerts per student/date).

Reference tables used by audience resolution: `users`, `students`, `guardians`,
`sections`; fee reminders read the Fees module's `invoices`; absence alerts read
`attendance_records`.

## 6. Permissions / RBAC involved

- `communication:read` — inbox, unread count, mark read
- `communication:create` — view sent history
- `communication:send` — compose and send messages
- `communication:delete` — delete messages
- `notifications:send` — trigger fee reminders and absence alerts
- `threads:read` — list/view threads, unread count, mark read
- `threads:create` — start a thread
- `threads:reply` — reply in a thread
- `threads:delete` — archive a thread (for the caller)
- `threads:manage` — add participants

(The separate Announcements module uses role-based `authorize("admin",
"teacher")` plus, per planning docs, an `announcements:manage`-style gate — see
that module's routes.)

`super_admin` bypasses checks. Inbox is owner-scoped; threads are
participant-scoped (a non-participant gets `404`).

## 7. Tenant isolation notes

All tables carry `institution_id`; `requireTenant` is router-wide and every
query filters by it. Audience resolution (`resolveAudience`) only selects users
within the caller's institution. Thread creation/add-participants validate every
participant id against the tenant (`validUserIds`) and reject cross-institution
ids; `assertParticipant` is both a participation and a tenant guard. Integration
tests "denies cross-institution delivery and targeting" and "rejects
cross-institution participants and access" cover this.

## 8. Key workflows

1. **Compose & send** — `POST /communication/messages`. `resolveAudience` maps
   the `audienceType` (+ `audienceRef`) to a de-duplicated set of user ids,
   inserts a `messages` header and `message_recipients` rows, then fires
   `dispatchExternal` (fire-and-forget email/SMS/push).
2. **Read inbox** — recipients pull `/communication/inbox`, see unread counts,
   and mark messages read.
3. **Threads** — start a direct/group thread (creator implicitly read), reply
   (updates `last_message_at`, marks sender read, notifies other participants),
   mark read, archive, or add participants (`threads:manage`; promotes to
   `group` past two participants).
4. **Fee reminders** — `POST /communication/fee-reminders` (optionally one
   student) finds students with outstanding invoices (`pending` /
   `partially_paid`), messages the student + guardians, and dispatches
   externally.
5. **Absence alerts** — `POST /communication/absence-alerts` for a date finds
   `absent` records, inserts a `notification_log` dedupe row (skips already-
   alerted students unless `force`), then messages and dispatches.

**Background jobs.** The in-process worker
(`backend/src/modules/jobs/jobs.worker.ts`) runs the same logic on a schedule:
the `fee_reminder_sweep` job calls `generateFeeReminders` and the
`absence_alert_sweep` job calls `generateAbsenceAlerts` (each requires the job's
`institutionId` + `createdBy`). See the Jobs module and the project's
background-jobs notes (`jobs` table, `JOB_WORKER_ENABLED`,
`JOB_WORKER_INTERVAL_MS`, `FOR UPDATE SKIP LOCKED`).

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md).

## 9. Test coverage summary

Two integration suites (need `DATABASE_URL`; `npm run test:integration`):

- `backend/tests/integration/communication.int.test.ts` (8 cases): send to an
  audience + inbox delivery; role-targeted recipients with owner-scoped inboxes;
  cross-institution denial; fee reminders to student + guardians; absence alerts
  with per-student/date de-duplication; device-token registration with graceful
  delivery when FCM/SMS/SMTP are unconfigured; permission guards; read/unread
  tracking.
- `backend/tests/integration/threads.int.test.ts` (9 cases): one-to-one and
  group threads; replies with per-participant read state; participant-only
  access; owner-scoping for parent/student; cross-institution rejection;
  permission checks (student cannot start a thread); archive + add-participants;
  graceful reply with no external channels; and no regression of the legacy
  inbox.

No dedicated unit tests for this module.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Message sent but `recipientCount` is 0 | Audience resolved to no users (e.g. no `user_id` on students) | Verify the audience and that recipients have user logins |
| No email/SMS/push received | SMTP / SMS / FCM unconfigured (degrades gracefully) | Configure the optional integration env vars; in-app inbox still works |
| 404 marking a message read | Message not in the caller's inbox | Only recipients can mark their own messages |
| 404 opening a thread | Caller is not a participant | Add them via `threads:manage`, or use the right account |
| Absence alerts not resent | De-duplicated via `notification_log` per student/date | Pass `force: true` to resend |
| Fee reminders skip a student | No outstanding invoice, or no linked user/guardian | Confirm `pending`/`partially_paid` invoices and user links |
| Background sweep does nothing | Worker disabled or job missing context | Set `JOB_WORKER_ENABLED`; ensure the job has `institutionId` + `createdBy` |

## 11. Future enhancement notes

- Message templates and scheduled/queued broadcasts.
- Rich content / attachments on messages and threads.
- Per-channel delivery receipts and retry tracking (beyond best-effort).
- User notification preferences (opt-in/out per channel).
- WebSocket / SSE live updates for inbox and threads.
- Tighter unification with the Announcements module where overlap exists.
