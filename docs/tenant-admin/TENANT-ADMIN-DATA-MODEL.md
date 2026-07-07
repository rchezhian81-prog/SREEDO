# Tenant Admin — Data Model Plan (entity-by-entity)

> **Status: PLANNING ONLY.** No code, no migrations. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` (canonical) and consistent with its verdicts,
> priorities, and §4 hardening themes. This document maps every tenant data
> entity to its live table, states its tenant-isolation posture, notes the
> School↔College variation, and captures the import/export need — then lists the
> corrective actions the master roadmap's **§4.1 (isolation, PRIORITY 1)** and
> build item **PR-T0** depend on.

**Legend.** `inst_id` = does the table carry an `institution_id` column?
Table names, migration numbers, and constraints below are verbatim from
`backend/src/db/migrations/*.sql` (spot-verified 2026-07-07). Where a constraint
is a multi-tenancy risk it is **bolded**.

**The one structural fact to hold onto:** isolation is **application-level only**
(no Postgres RLS). Every query must carry `WHERE institution_id = $1`, and every
inbound FK must be proven to belong to the tenant before it is joined or echoed.
The **early** tables (0002–0009, pre-tenancy) kept **global** UNIQUE constraints
and **global** sequences; the **later** tables (0015+, and all college tables in
0023) already use the correct `UNIQUE(institution_id, …)` pattern. The gap
between those two eras is the whole of §"Data-model corrective actions".

---

## 1. Academic foundation

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Academic year | `academic_years` (0002) | `name`, `start_date`, `end_date`, `is_current` | Y | **`name` is globally `UNIQUE` (0002:5) — RE-SCOPE.** Two tenants cannot both have "2025-2026". | Shared; college `semesters.academic_year_id` FKs it (0023) | Export only (settings) |
| Class / Program | `classes` (0002) | `name`, `academic_year_id` | Y | **`name` is globally `UNIQUE` (0002:14) — RE-SCOPE.** Two tenants cannot both have "Grade 1". | **School** = `classes`; **College** = `programs` (0023) | Export only |
| Section / Batch | `sections` (0002) | `name`, `class_id`, `teacher_id` | Y | `UNIQUE(class_id, name)` (0002:46) — correctly scoped-by-parent (class is per-tenant). No change once `classes.name` re-scoped. | **School** = `sections`; **College** = `batches`/`semesters` (0023) | Export only |
| Department | `departments` (0023) | `name`, `code`, `head_teacher_id` | Y | `UNIQUE(institution_id, code)` — correct pattern. | **College-only** | Export |
| Program / Course | `programs` (0023) | `name`, `code`, `duration_semesters`, `department_id` | Y | `UNIQUE(institution_id, code)` — correct. | **College-only** | Export |
| Batch | `batches` (0023) | `name`, `start_year`, `program_id` | Y | `UNIQUE(institution_id, program_id, name)` — correct. | **College-only** | Export |
| Semester | `semesters` (0023) | `name`, `number`, `program_id`, `academic_year_id` | Y | `UNIQUE(institution_id, program_id, number)` — correct. | **College-only** | Export |
| Subject / Course | `subjects` (0002, shared) | `name`, `code` | Y | **`code` is globally `UNIQUE` (0002:52) — RE-SCOPE.** Two tenants cannot both have "MATH101". | Shared master; linked two ways ↓ | Import (bulk) + Export |
| Subject↔class link | `class_subjects` (0002) | `section_id`, `subject_id` | Y | `UNIQUE(section_id, subject_id)` (0002:89) — scoped-by-parent. Thinly surfaced in UI (master §3.2). | **School** link | Export |
| Subject↔program link | `program_subjects` (0023) | `program_id`, `semester_id`, `subject_id`, **`credits`** | Y | `UNIQUE(institution_id, semester_id, subject_id)` — correct. Adds `credits` (school link has none). | **College** link | Export |

## 2. People

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Student | `students` (0002 + Profile-v2 `0071`) | `admission_no`, `first_name`, `section_id`, demographics (0071), `deleted_at` (soft-delete 0007) | Y | **`admission_no` globally `UNIQUE` (0002:59) + fed by the GLOBAL `student_admission_seq` (0009) — RE-SCOPE + per-tenant numbering.** `section_id` is **not** validated in-tenant on write (master §4.1 LOW leak). `user_id` UNIQUE is fine (a login belongs to one tenant). | **School** → `section_id`; **College** → `enrollments` (program/semester/batch, 0023), not sections | **Import (bulk CSV) — exists**; Export (reason-gated PII) |
| Guardian | inline cols on `students` + link `guardians` (0016) | `students.guardian_*`, link `(user_id, student_id, relationship)` (0070) | Y (via student) | `guardians UNIQUE(user_id, student_id)` (0016:12); drives parent owner-scoping (`utils/scope.ts` → `childStudentIdsForUser`). | Shared | Via student import; Export |
| Teacher / Faculty | `teachers` (0002) | `employee_no`, `first_name`, `user_id` | Y | **`employee_no` globally `UNIQUE` (0002:22) + GLOBAL `teacher_employee_seq` (0009) — RE-SCOPE + per-tenant numbering.** **This is the ONLY staff master** — non-teaching staff are overloaded onto it (master §3, #9). | Shared (label Teacher↔Faculty via `useTerms`); college allocation via `staff_allocations` (0023) | **Import (bulk) — exists**; Export |
| Non-teaching staff | **MISSING** (overloaded onto `teachers`) | — | — | No dedicated master; role/dept/payroll semantics muddled with academic staff. | Both | Import + Export (when built) |

## 3. Admissions

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Enquiry / Application | `admission_applications` (0049) | applicant details, `status`, `applied_class/program`, convert→student | Y | Public enquiry endpoint writes tenant-scoped; convert-to-student must set the tenant's `admission_no` via re-scoped numbering. | School class vs college program target | Export (funnel reports) |

## 4. Attendance

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Daily attendance | `attendance_records` (0003) | `student_id`, `date`, `status` | Y | **HIGH — `UNIQUE(student_id, date)` is GLOBAL (0003:14).** `attendance.service.ts` `bulkMark` inserts with the caller's `institution_id` but never checks `studentId` ownership, so its `ON CONFLICT (student_id,date) DO UPDATE` lets tenant A overwrite tenant B's row. **Fix first (PR-T0).** | Both (daily) | Export (registers) |
| Period attendance | `period_attendance` (0067) | `student_id`, `date`, `period_id`, `status` | Y | Already carries the correct in-tenant `studentId` guard — **copy this into daily `bulkMark`.** | Both (period/subject-wise) | Export |

## 5. Fees & finance

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Fee structures / categories / schedules / fine rules / discounts | `fee_structures`, `fee_categories`, `fee_schedules`, `fee_fine_rules`, `fee_discounts` (0004 / 0033) | amounts, due dates, rules | Y | `fee_structures` gained `program_id`/`semester_id` (0023) for college. | Structure targets class (school) or program/semester (college) | Export |
| Invoice | `invoices` (0004) | **`invoice_no`**, `student_id`, `amount`, `amount_paid` (0008) | Y | **`invoice_no` globally `UNIQUE` (0004:16) — RE-SCOPE + per-tenant numbering.** `createInvoice` does not ownership-check `studentId` (master §4.1 / §3 #6). | Both | Export (reason-gated $) |
| Payment / refund / order | `payments` (0004), `payment_refunds` (0061), `payment_orders` (0032) | amount, method, provider ref | Y | `payment_orders.order_no` UNIQUE (0032) + `(provider,event_id)` idempotency — gateway adapter is a **stub** (master §4.5). | Both | Export (reason-gated $) |
| Finance ledger | `finance_transactions` (0050) | debit/credit, category | Y | General tenant ledger. | Both | Export |
| Payroll | `payroll` (0029) | staff pay runs, components | Y | Keyed on `teachers` staff master (see gap #2). | Both | Export (reason-gated $) |

## 6. Exams & results

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Exam | `exams` (0005) | `name`, `date`, `semester_id` (0023) | Y | `semester_id` added additively (0023) for college. | School term vs college semester | Export |
| Exam result | `exam_results` (0005) | `student_id`, `subject_id`, `marks` | Y | `upsertResults` does not in-tenant-check student/subject (master §4.1 LOW echo leak). | Both | **Import (marks) desirable**; Export (mark-sheets/report-cards PDF) |
| Grade bands | `grade_bands` (0017) | band, min/max, `grade_point` (0023) | Y | `grade_point` added (0023) → college GPA/CGPA. | School grades vs college GPA | Export |

## 7. Timetable

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Periods / rooms | `periods`, `rooms` (0015) | slot times, room code | Y | `UNIQUE(institution_id, name/code)` (0015) — correct pattern. | Both | Export |
| Timetable entry | `timetable_entries` (0015 + 0023) | `day_of_week`, `period_id`, `section_id` **OR** `semester_id` | Y | Race-safe partial unique indexes per tenant (0015/0023); `CHECK(section_id IS NOT NULL OR semester_id IS NOT NULL)`. | **School** → `section_id`; **College** → `semester_id` (0023) | Export (CSV — exists) |

## 8. Extended operations

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Transport | `vehicles`, `drivers`, `transport_routes`, `route_stops`, `student_transport`, `transport_fees`, `transport_trips`, `transport_invoices` (0025) | routes, stops, allocations→invoices | Y | All `UNIQUE(institution_id, …)` (0025) — correct pattern. | Both | Export |
| Hostel | `hostels`, `hostel_blocks`, `hostel_rooms`, `hostel_allocations`, `hostel_fees`, `hostel_invoices` (0026) | structure, bed allocation (`FOR UPDATE`), fees | Y | All `UNIQUE(institution_id, …)` (0026) — correct. | Both (college-leaning) | Export |
| Library | `book_categories`, `books`, `book_copies`, `library_members`, `book_issues`, `book_reservations` (0024 / 0059) | catalogue, circulation, holds | Y | `UNIQUE(institution_id, …)` + partial-unique active-issue index (0024) — correct. | Both | Import (catalogue) + Export |
| Inventory | `item_categories`, `vendors`, `inventory_items`, `purchases`, `stock_movements` (0027) | stock ledger (in/out/adjust, negative-guarded) | Y | `UNIQUE(institution_id, …)` (0027) — correct. | Both | Import (items) + Export |
| Documents | `documents` (0019) categories certificate/tc/id_card | file refs, category | Y | Tenant-scoped; PDFs generated (`pdfs` module). | Both | Export (generated PDFs) |
| Transfer certificate | `transfer_certificates` (0034) | student, dues-gate, serial | Y | Dues-gated issuance. | School TC vs college leaving cert | Export (PDF) |

## 9. Engagement, communication & discipline

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Communication | `messages`, `message_recipients`, `device_tokens`, `notification_log` (0018); `threads` (0035); `announcements` (0006) | in-app + email/SMS/push fan-out | Y | Tenant-scoped; SMS/push providers optional (degrade). | Both | Export (delivery logs) |
| Homework | `homework`, `homework_submissions` (0020) | assignment, `section_id`, submission, grade | Y | **`section_id NOT NULL` → SCHOOL-ONLY (master §3 #20 / §4.3). Needs an additive college/semester variant** like exams/fees/timetable got. | **School-only today** | Export |
| Discipline | `disciplinary_records`, `disciplinary_actions` (0037) | incident, status machine, audit, portal flag | Y | Tenant-scoped; sensitive PII. | Both | Export (reason-gated) |
| Calendar | `calendar_events` (0051) | `type` (incl. `meeting`), date, audience | Y | Tenant-scoped. `type='meeting'` is the **only** current PTM primitive. | Both | Export |

## 10. Staff leave, attendance & HR

| Entity | Table (migration) | Key fields | inst_id | Isolation note | School / College | Import / Export |
|---|---|---|:--:|---|---|---|
| Leave types / balances / requests | `leave_types`, `leave_balances`, `leave_requests` (0028) | type, balance, request→approve | Y | `UNIQUE(institution_id, …)` (0028) — correct. **STAFF leave only.** | Both | Export |
| Staff attendance | `staff_attendance` (0028) | `teacher_id`, `date`, status | Y | `UNIQUE(institution_id, teacher_id, date)` (0028:49) — **the correct per-tenant attendance shape** the daily student table lacks. | Both | Export |
| Student leave | **MISSING** | — | — | No student leave-application → approval → attendance integration. | Both | Export (when built) |

## 11. Missing tables (net-new, additive)

| Entity | Status | Nearest existing primitive | School / College |
|---|---|---|---|
| PTM / parent-teacher meetings | **MISSING** | only `calendar_events.type='meeting'` | Both (slots/invites/attendance/notes) |
| Student leave application | **MISSING** | staff `leave_requests` (0028) is the shape to fork | Both |
| Co-curricular / activities | **MISSING** | — | Both |
| Syllabus / lesson plan | **MISSING** | `class_subjects`/`program_subjects` | Both (school class vs college course) |
| Substitute / relief teacher | **MISSING** | `timetable_entries` + `staff_attendance` | School-leaning |
| Question bank | **MISSING** | `exams` | Both |
| Non-teaching staff master | **MISSING** | overloaded onto `teachers` (0002) | Both |
| Tenant Help / SOP | **MISSING** | `help` module is platform-only (`help:read` never granted to tenant roles) | Both |

---

## Data-model corrective actions

All fixes below are for the master roadmap's **§4.1 (PRIORITY 1)** and land in
**PR-T0** (isolation hardening) before/with the first feature PR.

> **HARD RULE — every fix is an ADDITIVE, newly-numbered migration in
> `backend/src/db/migrations/`. Never edit an applied migration (0002–0071 are
> live).** A new migration may `ALTER`/`DROP CONSTRAINT`/`ADD CONSTRAINT` and
> backfill — that is normal schema evolution, distinct from editing a shipped
> file. `runMigrations()` applies them automatically on deploy (`src/server.ts`).

### (1) Re-scope the 6 global UNIQUE namespaces + move numbering per-tenant

| # | Table.column | Today | Target (new migration) |
|---|---|---|---|
| 1 | `academic_years.name` | global `UNIQUE` (0002:5) | `UNIQUE(institution_id, name)` |
| 2 | `classes.name` | global `UNIQUE` (0002:14) | `UNIQUE(institution_id, name)` |
| 3 | `subjects.code` | global `UNIQUE` (0002:52) | `UNIQUE(institution_id, code)` |
| 4 | `students.admission_no` | global `UNIQUE` (0002:59) + global `student_admission_seq` (0009) | `UNIQUE(institution_id, admission_no)` + **per-tenant numbering** |
| 5 | `teachers.employee_no` | global `UNIQUE` (0002:22) + global `teacher_employee_seq` (0009) | `UNIQUE(institution_id, employee_no)` + **per-tenant numbering** |
| 6 | `invoices.invoice_no` | global `UNIQUE` (0004:16) | `UNIQUE(institution_id, invoice_no)` + **per-tenant numbering** |

- **Constraint swap is data-safe.** Widening a key from `(x)` to
  `(institution_id, x)` can only *relax* uniqueness — it can never create a new
  collision on rows that were already globally unique. So each new migration
  simply `DROP`s the old constraint and `ADD`s the tenant-scoped one; no dedupe
  of existing rows is required.
- **Numbering** (`admission_no`, `employee_no`, `invoice_no`) is the part that
  needs care. The two global sequences (0009) and the invoice-number generator
  (`fees.service`) hand out globally-monotonic numbers. Replace with per-tenant
  numbering via a new additive `tenant_number_sequences(institution_id, kind,
  next_val)` counter table (row-locked increment) — or a `MAX(...)+1` under a
  per-tenant advisory lock — and switch the three services to it. Backfill the
  starting `next_val` per tenant from the current `MAX` (mirrors the 0009
  `setval` backfill). Leave the old global sequences in place (harmless) so no
  applied migration is touched. `students.user_id` / `teachers.user_id` UNIQUE
  stay global — a login legitimately belongs to one tenant.

### (2) Make daily attendance per-tenant (the HIGH bug)

- **Schema:** new migration `DROP`s the global `attendance_records
  UNIQUE(student_id, date)` (0003:14) and `ADD`s `UNIQUE(institution_id,
  student_id, date)`, so `ON CONFLICT` can only touch the caller's own tenant.
- **App:** add the in-tenant `studentId` ownership check to
  `attendance.service.ts` `bulkMark` before insert — **copy the guard
  `period_attendance` (0067) already has.** Do both (defense in depth). This is
  the single item flagged **HIGH / fix-first** in master §4.1 and §9.

### (3) Add in-tenant FK validation (LOW read/echo leaks)

Standardize on the college modules' `assertRef` / `promoteStudents` pattern:
before insert or echo, prove each inbound FK belongs to `tenantId(req)`.
Targets called out in master §4.1:

- `students` — `section_id`
- `exams` — `upsertResults` `student_id` + `subject_id`
- `academics` — `listClasses` count
- `fees` — `createInvoice` `student_id`

This is app-level (services), no schema change; it complements (1)/(2).

### (4) Add the missing tables (additive, additive-column-safe)

Per §11: `ptm_meetings` (+ slots/invitees/attendance/notes), `student_leave_*`
(fork the staff `leave_*` shape, wire to attendance), `co_curricular_*`,
`syllabus`/`lesson_plans`, `substitute_arrangements`, `question_bank`, a
**non-teaching staff master** (or generalize `teachers`→`staff` additively,
keeping `teachers` as a view/subset), and tenant Help/SOP tables. All
`institution_id`-scoped with `UNIQUE(institution_id, …)` from day one. **Homework
needs the additive college variant** — add nullable `semester_id` and relax
`section_id NOT NULL` with a `CHECK(section_id IS NOT NULL OR semester_id IS NOT
NULL)`, exactly as `timetable_entries` did in 0023.

### (5) Isolation is app-level (no RLS) — plan a safety net

Every fix above still relies on the service remembering `WHERE institution_id`.
As **defense in depth (Future)**, evaluate Postgres **Row-Level Security** (a
`USING (institution_id = current_setting('app.tenant')::uuid)` policy set from a
per-request `SET LOCAL`) or a query-builder guard, so one forgotten filter can't
leak. Not in PR-T0; tracked as a future hardening item per master §4.1.

---

## Per-entity import / export requirement summary

Aligned to master §6 (rules 4/5/8: mask sensitive fields, reason-gate + audit
sensitive exports, dry-run + row-level errors on import) and §8. Feeds the
unified **tenant Import/Export center** (master §5, PR-T5).

| Entity | Import (bulk) | Export | Sensitive → reason-gate + audit |
|---|:--:|:--:|:--:|
| Students | ✅ exists | CSV/PDF | **Yes** (PII/demographics) |
| Teachers / staff | ✅ exists | CSV | **Yes** (staff PII) |
| Subjects, classes/programs, sections/batches | Desirable | CSV | No |
| Library catalogue, inventory items | Desirable | CSV | No |
| Exam results / marks | Desirable | CSV + PDF (mark-sheet/report-card) | Partial (grades) |
| Attendance (daily/period) | — (marked in-app) | CSV register | No |
| Invoices / payments / refunds / payroll | — | CSV + PDF | **Yes** (financial) |
| Disciplinary records | — | CSV/PDF | **Yes** (sensitive) |
| Transport / hostel / documents / TC | — | CSV + PDF | Partial |
| Communication / calendar / admissions | — | CSV | No |
| Everything else | — | per-module CSV (exists) | Case-by-case |

**Gap (master §3 #28):** import exists only for **students + teachers**; there is
**no unified tenant Import/Export center** (the Data Export Center is Super-Admin,
0099). Build one that extends coverage above, enforces dry-run/row-level import
validation, and reason-gates + audits sensitive exports.
