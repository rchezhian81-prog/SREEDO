# Database Schema — SRE EDU OS

Deliverable **#2 Database schema**. Two parts: the **current schema** (exactly
what the applied migrations create) and the **target schema** (tables added as
planned modules ship). PostgreSQL is the system of record; MongoDB holds two
optional collections.

**Conventions (apply to every table):** UUID PKs via `gen_random_uuid()`;
`created_at TIMESTAMPTZ DEFAULT now()`; `updated_at` maintained by the shared
`set_updated_at()` trigger where rows mutate; enums via Postgres `CREATE TYPE`;
status fields guarded by `CHECK`; all FKs explicit with intentional
`ON DELETE` behavior; money as `NUMERIC(12,2)`. Never edit an applied migration —
add a new numbered file in `backend/src/db/migrations/`.

---

## Part 1 — Current schema (migrations 0001–0006)

### Enums
- `user_role` = `admin | teacher | accountant | student | parent`
- `attendance_status` = `present | absent | late | excused`

### 0001 — Auth
**users** — `id`, `email` (unique), `password_hash`, `full_name`, `role`
(`user_role`), `phone`, `is_active` (default true), `created_at`, `updated_at`
(trigger).
**refresh_tokens** — `id`, `user_id` → users (CASCADE), `token_hash` (unique,
SHA-256), `expires_at`, `created_at`. Index on `user_id`.

### 0002 — Academics
**academic_years** — `id`, `name` (unique), `start_date`, `end_date`,
`is_current` (bool).
**classes** — `id`, `name` (unique), `grade_level` (int).
**teachers** — `id`, `user_id` → users (SET NULL, unique), `employee_no`
(unique), `first_name`, `last_name`, `email`, `phone`, `qualification`,
`specialization`, `joining_date`, `is_active`, timestamps (trigger).
**sections** — `id`, `class_id` → classes (CASCADE), `name`,
`homeroom_teacher_id` → teachers (SET NULL), `capacity` (default 40);
unique `(class_id, name)`.
**subjects** — `id`, `name`, `code` (unique).
**students** — `id`, `user_id` → users (SET NULL, unique), `admission_no`
(unique), `first_name`, `last_name`, `date_of_birth`, `gender`
(CHECK male/female/other), `section_id` → sections (SET NULL), `guardian_name`,
`guardian_phone`, `guardian_email`, `address`, `status`
(CHECK active/inactive/graduated/transferred), `enrolled_at`, timestamps
(trigger). Indexes on `section_id`, `status`.
**class_subjects** — `id`, `section_id` → sections (CASCADE), `subject_id` →
subjects (CASCADE), `teacher_id` → teachers (SET NULL); unique
`(section_id, subject_id)`. *(Table exists; endpoints planned.)*

### 0003 — Attendance
**attendance_records** — `id`, `student_id` → students (CASCADE), `date`,
`status` (`attendance_status`), `remarks`, `marked_by` → users (SET NULL),
timestamps (trigger); unique `(student_id, date)`. Indexes on `date`,
`student_id`.

### 0004 — Fees
**fee_structures** — `id`, `name`, `class_id` → classes (CASCADE),
`academic_year_id` → academic_years (CASCADE), `amount` (NUMERIC, ≥0),
`frequency` (CHECK one_time/monthly/term/annual).
**invoices** — `id`, `invoice_no` (unique), `student_id` → students (CASCADE),
`fee_structure_id` → fee_structures (SET NULL), `description`, `amount_due`
(≥0), `due_date`, `status` (CHECK pending/partially_paid/paid/cancelled),
timestamps (trigger). Indexes on `student_id`, `status`.
**payments** — `id`, `invoice_id` → invoices (CASCADE), `amount` (>0), `method`
(CHECK cash/card/bank_transfer/upi/cheque/online), `reference`, `paid_at`,
`received_by` → users (SET NULL). Index on `invoice_id`.

### 0005 — Exams
**exams** — `id`, `name`, `academic_year_id` → academic_years (CASCADE),
`start_date`, `end_date`.
**exam_results** — `id`, `exam_id` → exams (CASCADE), `student_id` → students
(CASCADE), `subject_id` → subjects (CASCADE), `marks_obtained` (≥0), `max_marks`
(>0, default 100), `grade`, `remarks`, timestamps (trigger); unique
`(exam_id, student_id, subject_id)`. Index on `student_id`.

### 0006 — Announcements
**announcements** — `id`, `title`, `body`, `audience` (CHECK
all/teachers/students/parents/staff), `is_pinned`, `created_by` → users
(SET NULL), `published_at`, timestamps (trigger). Index on `published_at DESC`.

### Relationships (current)
```
users 1─1 teachers          users 1─1 students
classes 1─* sections        sections 1─* students
sections *─* subjects (via class_subjects, + teacher)
students 1─* attendance_records
students 1─* invoices 1─* payments    fee_structures 1─* invoices
exams 1─* exam_results *─1 students    subjects 1─* exam_results
academic_years 1─* {fee_structures, exams}
```

### MongoDB (optional)
- **audit_logs** — `{ userId, role, method, path, statusCode, ip, body?, at }`.
- **ai_conversations** — `{ userId, messages:[{role,content,at}], createdAt, updatedAt }`.

---

## Part 2 — Target schema (planned, by phase)

New tables introduced as modules ship. All inherit the conventions above and, in
Phase A, gain an `institution_id` (and where relevant `branch_id`) FK for
multi-tenancy.

### Phase A — Multi-tenancy, Super Admin, permissions
- **institutions** — `id`, `name`, `type` (school|college), `code`, `settings`
  (JSONB — holds super-admin **feature flags / enabled modules / contact**),
  `is_active`.
- **data_exports** ✅ (migration `0030`) — `id`, `institution_id`, `kind`,
  `status`, `summary` (JSONB; counts + metadata only, no secrets), `requested_by`
  — the super-admin backup/export history.
- *(Request-level audit logs live in MongoDB `audit_logs` — best-effort; the
  super-admin viewer reads them and degrades gracefully when Mongo is unconfigured.)*
- **platform_audit_log** ✅ (migration `0039`) — `id`, `action` (e.g.
  `institution.suspend`, `subscription.assign`, `impersonate.start`),
  `target_type`, `target_id`, `institution_id`, `actor_id`→users, `actor_email`,
  `actor_role`, `detail` (JSONB — curated, **no secrets**), `ip`, `created_at`. A
  **durable** (always-available) cross-tenant trail of super-admin platform
  actions, written by the `/platform/*` module and surfaced by its filterable
  read-only audit viewer. Adds `platform:*` permissions (read/manage_institutions/
  manage_subscriptions/audit_read/health_read/impersonate/usage_read), granted to
  **super_admin only**.
- **branches** — `id`, `institution_id`→institutions, `name`, `address`,
  `timezone`.
- **subscription_packages** — `id`, `name`, `limits` (JSONB), `price`,
  `billing_cycle`.
- **institution_subscriptions** — `id`, `institution_id`, `package_id`,
  `starts_at`, `ends_at`, `status`.
- **permissions** — `id`, `key` (`module:action`), `description`.
- **role_permissions** — `role` × `permission_id` grants (+ optional
  `institution_id` for per-tenant overrides).
- *(Add `institution_id`/`branch_id` columns to existing tenant-scoped tables.)*

### Phase B — College mode + timetables
College tables (migration `0023`) are all tenant-scoped (`institution_id`) and
used when `institutions.type = 'college'`; the school flow is unaffected.
- **departments** ✅ — `id`, `institution_id`, `name`, `code`, `head_teacher_id`.
- **programs** (courses) ✅ — `id`, `institution_id`, `department_id`, `name`,
  `code`, `duration_semesters`.
- **batches** ✅ — `id`, `institution_id`, `program_id`, `name`, `start_year`.
- **semesters** ✅ — `id`, `institution_id`, `program_id`, `name`, `number`,
  `academic_year_id`, dates.
- **program_subjects** ✅ — `id`, `institution_id`, `program_id`, `semester_id?`,
  `subject_id`, `credits` (drives GPA/CGPA weighting).
- **enrollments** ✅ — `id`, `institution_id`, `student_id`, `program_id`,
  `semester_id?`, `batch_id?`, `status`.
- **staff_allocations** ✅ — `id`, `institution_id`, `teacher_id`,
  `department_id?`, `program_id?`, `subject_id?`.
- Additive college columns: `exams.semester_id`, `fee_structures.program_id` +
  `fee_structures.semester_id`, `grade_bands.grade_point`,
  `timetable_entries.semester_id` (section_id now nullable, one-of check).
- **rooms** — `id`, `branch_id`, `name`, `capacity`, `type`.
- **periods** — `id`, `name`, `start_time`, `end_time`.
- **timetable_slots** — `id`, `section_id`, `period_id`, `day_of_week`,
  `subject_id`, `teacher_id`, `room_id`; uniqueness/conflict checks on
  (teacher, day, period) and (room, day, period).

### Phase C — Portals, homework, communication, uploads
- **homework** — `id`, `section_id`, `subject_id`, `teacher_id`, `title`,
  `description`, `due_date`, `attachment_url`.
- **homework_submissions** — `id`, `homework_id`, `student_id`, `submitted_at`,
  `attachment_url`, `status`, `grade`.
- **messages** — `id`, `sender_id`, `recipient_id`/`thread_id`, `body`,
  `read_at` (internal messaging).
- **notifications** — `id`, `user_id`, `type`, `payload` (JSONB), `read_at`,
  `channel` (push/email/sms).
- **device_tokens** — `id`, `user_id`, `fcm_token`, `platform`.
- **documents** — `id`, `owner_type`, `owner_id`, `kind`, `url`, `mime`,
  `size`, `uploaded_by` (secure object-storage references).

### Phase D — Library, transport, hostel, inventory, payroll
- **Library:** ✅ (migration `0024`, all tenant-scoped) `book_categories`,
  `books` (isbn/author/publisher/edition/subject/language/rack), `book_copies`
  (status available|issued|lost|damaged|retired, unique accession), `library_members`
  (student or staff), `book_issues` (issue/return/renew, fine_amount + fine_status,
  optional `invoice_id` → Fees), `library_settings` (loan days, fine/day, limits).
- **Transport:** ✅ (migration `0025`, all tenant-scoped) `vehicles`
  (insurance/fitness/permit expiry, capacity), `drivers` (license + expiry +
  helper), `transport_routes` (assigned vehicle/driver), `route_stops` (order,
  pickup/drop times, zone, distance), `student_transport` (route/stop allocation),
  `transport_fees` (route- or stop-level, partial-unique), `transport_trips`
  (daily log), `transport_invoices` (links generated fee invoices → routes/dues).
- **Hostel:** ✅ (migration `0026`, all tenant-scoped) `hostels` (type, warden,
  capacity), `hostel_blocks`, `hostel_rooms` (floor, type, capacity, status),
  `hostel_allocations` (room/bed, active/vacated/transferred; partial-unique on
  active student + active bed), `hostel_fees` (hostel- or room-type-level,
  partial-unique), `hostel_invoices` (links generated fee invoices → hostel/dues).
- **Inventory:** ✅ (migration `0027`, all tenant-scoped) `item_categories`,
  `vendors`, `inventory_items` (unit, opening/current/min stock, location),
  `purchases` + `purchase_items` (stock-in, optional `document_id`), `stock_issues`
  (stock-out), `stock_adjustments` (signed, damage/lost/correction), and
  `stock_movements` (unified audit ledger: change + balance_after per movement).
- **Staff attendance & leave:** ✅ (migration `0028`, all tenant-scoped)
  `staff_attendance` (per teacher/date; present/absent/half_day/leave/holiday,
  check-in/out, late, leave_type_id), `leave_types`, `leave_balances`,
  `leave_requests` (request → approve/reject/cancel; approval deducts balance +
  auto-marks attendance).
- **Payroll:** ✅ (migration `0029`, all tenant-scoped) `salary_components`
  (earning/deduction, fixed|percent), `salary_structures` (+ `salary_structure_
  components`; one active per staff = revision history), `payroll_runs` (one per
  month, draft|finalized), `payslips` (unique per staff/month; snapshots
  attendance + gross/deductions/net), `payslip_lines` (earning/deduction breakdown).

- **AI Insights:** ✅ (migration `0031`) — **no new tables**. Adds the `ai:*`
  permissions (`ai:read`, `ai:summarize`, `ai:risk_alerts`, `ai:document_search`,
  `ai:workflow_suggestions`) and role grants. All insights are computed
  deterministically from existing tenant-scoped tables (students, attendance_
  records, invoices, documents, leave_requests, inventory_items, etc.);
  embeddings are computed on the fly when OpenAI is configured, and AI usage is
  logged best-effort to the MongoDB `ai_usage` collection.
- **Online Fee Gateway:** ✅ (migration `0032`, all tenant-scoped) `payment_orders`
  (`institution_id`, `invoice_id`, `student_id`, `order_no` unique, `amount`,
  `currency`, `status` created|pending|success|failed|cancelled|expired|refunded,
  `provider`, `gateway_ref`/`gateway_payment_id`/`refund_ref` — non-sensitive refs
  only, `payment_id` → the `payments` row created on success, `checkout_url`,
  `created_by`; unique `(provider, gateway_ref)`), and `payment_webhook_events`
  (`provider` + `event_id` unique for **idempotency**, `event_type`,
  `payment_order_id`, `status`). **No card/bank/UPI data is stored.** Adds the
  `online_payments:*` permissions and grants (admin/accountant; student & parent
  get read+create, owner-scoped). The per-institution on/off switch is a
  `featureFlags.onlinePayments` flag in `institutions.settings`; provider secrets
  come from env only.
- **Fee Management Depth:** ✅ (migration `0033`, all tenant-scoped) `fee_categories`,
  `fee_schedules` (category + amount + `term_type`/`term_label`/`due_date` +
  optional class/section/program/semester/student targets), `fee_fine_rules`
  (fixed|per_day|percent + grace), `invoice_fines` (applied/waived audit),
  `fee_discounts` (discount|scholarship, fixed|percent), `invoice_discounts`
  (pending|approved|rejected, applied_by/approved_by audit). `invoices` is
  augmented with `category_id`, `fee_schedule_id`, `discount_total`, `fine_total`
  (unique partial index on `(fee_schedule_id, student_id)` for idempotent
  generation); `amount_due` remains the **net payable** (base − discounts + fines)
  so payments/gateway are unchanged. Adds `fee_categories|fee_schedules|fee_fines|
  fee_discounts:*` + `fee_reports:read` permissions (admin full; accountant all
  except category delete / fine waive / discount approve).
- **Transfer Certificates:** ✅ (migration `0034`, tenant-scoped) `transfer_certificates`
  (`tc_no` unique via the atomic `transfer_certificate_seq` sequence, `student_id`,
  snapshotted `admission_no`/`class_name`/`section_name`/`program_name`/
  `semester_name`/`academic_year`, `date_of_issue`, `last_attendance_date`,
  `leaving_reason`, `conduct`, per-area dues-status strings, `dues_override` +
  reason, `remarks`, `status` draft|issued|cancelled, issued/cancelled audit
  columns). Issuing flips `students.status` to `transferred` (no rows deleted).
  Adds `transfer_certificates:*` permissions (admin full incl. `override_dues`;
  accountant all except `override_dues`; student & parent get `read` + `download`,
  owner-scoped).
- **Threaded messaging:** ✅ (migration `0035`, tenant-scoped) `threads`
  (`subject`, `type` direct|group, `created_by`, `last_message_at`),
  `thread_participants` (`thread_id` + `user_id` unique, `last_read_at` for
  read state, `archived_at` for per-user archive, `added_by`), `thread_messages`
  (`sender_id`, `body`). Access is **participant-scoped**; the legacy
  `messages`/`message_recipients` tables are untouched. Adds `threads:*`
  permissions (admin full incl. manage/reports; teacher/accountant
  read/create/reply/delete; student & parent read+reply). Attachment foundation:
  thread messages can later carry documents (deferred to avoid changing the
  documents owner-type enum).
- **Custom report builder:** ✅ (migration `0036`, tenant-scoped) `custom_reports`
  (`name`, `report_key` — a Reports Center registry key, `columns` JSONB array of
  selected column keys, `filters` JSONB, `sort` JSONB `{key,dir}`, `group_by`,
  `visibility` private|shared, `created_by`, timestamps with a `set_updated_at`
  trigger). A saved definition stores *what to run*, never a data snapshot — every
  run re-executes the underlying report live and re-checks its permission, so a
  custom report can never widen access. Adds `custom_reports:*` permissions
  (admin full incl. `share`; accountant all except `share`; teacher
  read/run/export). No new data tables — it composes the existing report registry.
- **Disciplinary records:** ✅ (migration `0037`, tenant-scoped) `disciplinary_records`
  (`student_id` + class/section/program/semester **snapshots**, `incident_date`,
  `category`, `severity` low|medium|high|critical, `description`, `reported_by`,
  `involved_staff`, `action_taken`, `follow_up_date`, `status`
  open|under_review|action_taken|closed|cancelled, `remarks`, closed/cancelled
  audit columns, `created_by`, `set_updated_at` trigger) and `disciplinary_actions`
  (an append-only **audit timeline**: `record_id`, `action`, `note`, `from_status`,
  `to_status`, `created_by`). Student rows are never deleted. Adds `disciplinary:*`
  permissions (admin full; teacher read/create/update/action/reports; student &
  parent only `portal_read`; accountant none). **Portal visibility is OFF by
  default** — gated by an institution feature flag (`institutions.settings ->
  featureFlags -> disciplinaryPortal`) PLUS `disciplinary:portal_read` PLUS
  owner-scoping.
- **Scheduled reports:** ✅ (migration `0038`, tenant-scoped) `scheduled_reports`
  (`report_id` → `custom_reports` **ON DELETE SET NULL** so a deleted report fails
  runs cleanly instead of vanishing the schedule, `name`, `frequency`
  daily|weekly|monthly, `run_time`, `timezone`, `day_of_week`/`day_of_month`,
  `recipients` JSONB user-id array, `channels` JSONB in_app|email, `export_format`
  csv|pdf|both, `enabled`, `last_run_at`, `next_run_at`, `created_by`,
  `set_updated_at` trigger) and `scheduled_report_runs` (audit history:
  `status` pending|running|success|failed|skipped, `trigger` manual|scheduled,
  started/completed, `error_message`, `export_format`, `export_bytes`, `row_count`,
  `recipient_count`, `delivery_status`, `triggered_by`). Generation reuses the
  Custom Report service (underlying-report permission always enforced); delivery
  goes to the existing `messages`/`message_recipients` (in-app) + best-effort
  email, filtered to recipients holding the report's permission. Adds
  `scheduled_reports:*` permissions (admin full; accountant all except `manage`;
  teacher read/create/run/history; student & parent none).
- **Background job queue:** ✅ (migration `0040`) `jobs` — `type`, `payload` JSONB
  (**never secrets**), `status` pending|running|success|failed|cancelled,
  `priority`, `attempts`/`max_attempts`, `run_at` (backoff pushes it forward),
  `locked_at`/`locked_by`, started/completed, `error` (short message only),
  `dedupe_key` (UNIQUE — idempotent enqueue, e.g. schedule+window),
  `institution_id` (tenant scope; null = platform), `created_by`,
  `set_updated_at` trigger. Claimed atomically via `FOR UPDATE SKIP LOCKED`
  (no double-processing, no external broker); retried with exponential backoff;
  permanently failed after `max_attempts`. The scheduler tick enqueues due
  `scheduled_reports` (handler `scheduled_report_run`); other handlers reuse the
  fee-reminder / absence-alert services. Adds `jobs:*` permissions (read/manage/
  retry/cancel/run_scheduler), granted to admin (own institution) + super_admin
  (platform-wide) only — no other role. An optional in-process worker runs on a
  timer when `JOB_WORKER_ENABLED=true` (off by default).
- **Observability:** ✅ (migration `0041`) — **no new tables**. Structured request
  logs ship to stdout (curated safe fields only); metrics are in-process counters
  with live DB gauges (queue depth, scheduled-report run counts) read at scrape
  time. Adds `observability:*` permissions (read/metrics/health/logs), granted to
  **super_admin only**, gating `/observability/metrics|health|overview`. Public
  `/health`, `/live`, `/ready` probes need no auth and expose no secrets/tenant
  data.

### Phase C/D supporting
- **fee_categories**, **fee_discounts/scholarships**, **fee_fines** — extend the
  fee engine (categories, term schedules, fines, discounts).
- **grade_bands** — `id`, `name`, `min_percent`, `max_percent`, `grade`, `points`
  for report-card generation.
- **disciplinary_records** — ✅ shipped (migration `0037`, see above).
  (`transfer_certificates` and `id_cards` are shipped too.)

### Multi-tenancy migration note
Adding `institution_id` to live tables is a breaking change done carefully in
Phase A: add nullable column → backfill a default institution → set NOT NULL →
add composite indexes → scope all queries. Sequenced as its own migration set.
