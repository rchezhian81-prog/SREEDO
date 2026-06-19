# Module Workflows — SRE EDU OS

Deliverable **#5 Module-wise workflow**. Step-by-step flows for each module.
✅ flows are live today; 🟡/⬜ describe the target behavior. Actors map to
[`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md).

---

## A. Authentication & sessions ✅
1. User submits email + password → `POST /auth/login` (rate-limited).
2. Server verifies bcrypt hash, issues 15-min access JWT + opaque refresh token
   (stored SHA-256-hashed).
3. Client stores tokens; sends `Authorization: Bearer` on each call.
4. On 401, client calls `POST /auth/refresh` (single-flight) → rotated tokens.
5. `POST /auth/change-password` re-hashes and **revokes all** refresh tokens.
6. `POST /auth/logout` deletes the presented refresh token.

## B. Super Admin onboarding ✅
1. Super Admin creates an **institution** (school|college) + first **branch**.
2. Assigns a **subscription package** (limits/features).
3. Creates the institution's first **admin** user.
4. Institution Admin logs in → scoped entirely to that `institution_id`.
5. ✅ Super Admin console (`/admin/*`, super-admin-only): global institution
   **settings** (status, contact, **enabled modules + feature flags**),
   **plan limits** (max students/staff enforced on create) + usage, a global
   **audit-log viewer** (Mongo trail, filters + CSV, graceful when Mongo off),
   safe **data export** (counts/metadata only — no secrets) with history, a
   read-only **cross-tenant snapshot** switch, and a **system-health** summary.
   All actions run through the audit middleware.

## C. Academic setup ✅ (school) / ✅ (college extensions)
1. Admin creates an **academic year** (marks one `is_current`).
2. Creates **classes** (grade levels) → **sections** (with capacity + homeroom
   teacher) → **subjects**.
3. Maps subject ↔ section ↔ teacher via **class_subjects** (🟡 API pending).
4. *College:* ✅ create **departments → programs/courses → semesters** (+ batches),
   attach subjects per program/semester with credits, enroll students, and
   allocate staff — see **§S. College mode**.

## D. Student admission & lifecycle 🟡
1. Office/Admin opens **New Student**, fills profile + guardian + section.
2. `POST /students` → server assigns next **admission number**, status `active`.
3. ✅ Upload documents/photo (object storage); ✅ generate **ID card** PDF
   (single + bulk per section). Transfer Certificate remains ⬜.
4. Ongoing: attendance, fees, exams link automatically by `student_id`.
5. Status transitions: `active → inactive | graduated | transferred`.
6. *(⬜)* On transfer, generate a **Transfer Certificate** PDF; switch to
   soft-delete (handover §8) so history is retained.

## E. Staff / teacher management 🟡
1. Admin creates a teacher → auto **employee number**; optionally link a `user`
   login.
2. Record qualification/specialization/joining date.
3. Assign subjects/sections (class_subjects).
4. ✅ **Staff attendance** — daily/bulk marking (present/absent/half-day/leave/
   holiday, check-in/out, late/early-out, remarks) + staff-wise monthly summary.
5. ✅ **Leave** — leave types (paid/unpaid) + balances; staff **request** →
   admin **approve/reject/cancel**; approval deducts the balance and **auto-marks
   attendance** as leave; leave register + balance reports. Staff see only their
   own; admins/HR manage all (`staff_attendance:*` / `leave:*`, tenant-scoped).
6. ✅ **Payroll-attendance summary** foundation (working/present/absent/half/paid+
   unpaid-leave/late per month) — input for the upcoming Payroll module.
7. *(⬜)* Timetable allocation, payroll run, performance reviews.

## F. Daily attendance ✅ (student) / ⬜ (staff)
1. Teacher selects **section + date** → `GET /attendance?...` returns roster with
   any existing marks.
2. Marks each student present/absent/late/excused (+ remarks).
3. `POST /attendance` **bulk upserts** (unique on student+date) → idempotent
   re-saves.
4. Dashboard shows today's present/absent counts; per-student history via
   `GET /attendance/students/:id`.
5. *(⬜)* Monthly/yearly export; **SMS/push** to guardians on absence; staff
   attendance + period-wise.

## G. Exams & results 🟡
1. Admin creates an **exam** (name, academic year, dates).
2. Teacher opens exam → enters marks per student/subject (max marks default 100).
3. `POST /exams/:id/results` **bulk upserts** (unique exam+student+subject).
4. *(⬜)* **Grade bands** auto-compute grade/points; **report-card PDF**;
   subject-wise analytics; per-student report via `GET /exams/students/:id/report` ✅.

## H. Fee management ✅
1. Accountant defines **fee structures** (class/year, amount, frequency) and
   **fee categories** (`fee_categories:*`).
2. Generates **invoices** per student → unique invoice number, status `pending` —
   manually, or from a **term-wise fee schedule** (`fee_schedules:*`) targeting a
   class/section/program/semester/student. Generation is **idempotent** (one
   invoice per schedule+student) with a **preview** of who'll be billed.
3. Records **payments** → server **rejects overpayment**, advances status
   `pending → partially_paid → paid`. Online collection via the gateway (§S').
4. **Late fines** (`fee_fines:*`): fixed / per-day / percent rules with a grace
   period; applying a fine raises the invoice's `amount_due` + `fine_total`;
   **waiver** is permission-gated and reverses it.
5. **Discounts/scholarships** (`fee_discounts:*`): apply (pending) → **approve**
   (separate permission) reduces `amount_due` + records `discount_total`; who
   applied/approved is audited. `amount_due` always stays the **net payable**, so
   payments + the online gateway need no changes.
6. `GET /fees/summary` → collected vs pending KPIs; `GET /fees/invoices/:id/breakdown`
   → base/fines/discounts/outstanding (owner-scoped). **Dues reports** (Reports
   Center, `fee_reports:read`): class/student/category dues, term collection, fine
   collection, discounts, outstanding, defaulters.
7. ✅ Payment **receipt PDF** (owner-scoped).

## I. Communication ✅
1. Admin/Teacher posts an **announcement** with **audience** + optional **pin**.
2. Clients list audience-filtered, pinned-first.
3. ✅ **In-app messaging**: compose to an audience (all students/parents, staff,
   class, section, individual) → per-recipient inbox with read/unread; staff see
   sent history + read counts. **email/SMS/FCM** fan-out (best-effort, optional).
4. ✅ **Fee reminders** (outstanding invoices) and **absence alerts** (absentees,
   de-duplicated per student/day) to students + guardians.
5. ✅ **Threaded messaging** (`/communication/threads`, `threads:*`): start a
   **thread** (one-to-one or group; participants validated same-institution),
   **reply**, and **per-participant read state** (thread + total unread counts,
   mark-read). Access is **participant-only** (a non-participant gets 404; no
   cross-tenant/cross-student leakage). Replies notify the other participants via
   the existing channel adapters (best-effort; graceful when unconfigured). Archive
   per-user; admins can add participants (`threads:manage`). Safe default: staff
   start threads (`threads:create`); students/parents `threads:reply` to threads
   they're in. Reports (Reports Center, `threads:reports`): messaging activity,
   volume by user, unread messages, staff–parent communication.
6. *(⬜)* Scheduled campaigns.

## J. AI assistant ✅ / AI advanced ✅
1. Staff asks a question → `POST /ai/assistant`.
2. Service injects **live KPIs** into the system prompt, calls **GPT-4o**, saves
   the turn to Mongo; returns the answer (history via `/ai/conversations`).
3. ✅ **AI Insights** (`/ai-insights`, `ai:*`, tenant-scoped, permission-guarded):
   - **Report/KPI summaries** (`/ai-insights/summary/{report}`) for attendance,
     fees, exams, homework, payroll, library, transport, hostel, inventory —
     deterministic metrics always; optional GPT narrative when configured.
   - **Attendance-risk alerts** (`/ai-insights/risk/attendance`) — active
     students below a threshold over a window (suggests a non-intrusive action;
     parent alerts are a suggestion only, never auto-sent).
   - **Fee pending/collection risk** (`/ai-insights/risk/fees`) — overdue +
     outstanding invoices with a follow-up suggestion; reminders go through
     Communication on **explicit** action only.
   - **Document search** (`/ai-insights/search`) — semantic (OpenAI embeddings
     over metadata, cosine-ranked) when configured, **keyword fallback**
     otherwise. Metadata only — never file contents or storage keys.
   - **Workflow suggestions** (`/ai-insights/suggestions`) — deterministic
     tenant-scoped prompts: fee reminders, pending leave, overdue books, low
     stock, transport/hostel dues.
   - **Dashboard** (`/ai-insights/dashboard`) — headline KPIs + suggestions.
   - **Guardrails:** every query is `institution_id`-scoped; each endpoint is
     `requirePermission`-guarded; AI usage logged best-effort to Mongo; degrades
     gracefully when OpenAI/Mongo/embeddings are unconfigured.

## K. Timetable ✅ (Phase B)
1. Admin defines **periods** and **rooms** (`/timetable/periods`, `/timetable/rooms`).
2. Builds per-section timetable: assign subject + teacher + room per day/period
   (`/timetable/entries`).
3. On save, the server runs **conflict checks** — same section, same teacher, or
   same room in one day+period is rejected with 409 (also guaranteed by partial
   unique indexes). Re-checked on update.
4. Teacher timetable is the same data sliced by `teacherId`; both class and
   teacher views export to CSV (`/timetable/export`).

## L. Homework / assignment ✅ (Phase C)
1. Teacher creates homework (section, subject, due date, attachment) → section is
   notified (in-app + best-effort email/SMS/push).
2. Student views in portal, submits text and/or a file (marked `late` past due);
   the teacher is notified on submit.
3. Teacher lists submissions and marks status/grade (reviewed/completed/late/
   resubmit + marks/remarks); parent monitors via the portal. Attachments use the
   protected, owner-scoped download route.

## M. Library ✅ (Phase D)
1. Admin sets circulation **settings** (loan days, fine/day, max renewals, max
   books/member) and builds the **catalogue**: categories → books → copies (each
   copy tracked: available/issued/lost/damaged/retired; accession auto or manual).
2. Register **members** (students — including college students — and staff).
3. **Issue** a copy to a member (by copy or any available copy of a book) with a
   due date; **renew** up to the limit; **return** marks the copy available (or
   lost/damaged) and **auto-computes the late fine** (days overdue × rate).
4. Fines can be **waived** (`library:fines`) or **posted to a student invoice**
   in the Fees module. Member borrowing history is available to staff and,
   owner-scoped, to the student/parent portal.
5. Reports (in the Reports Center): book stock, issued, overdue, member history,
   lost/damaged, fines. Permissions: `library:read|create|update|delete|issue|
   return|fines|reports` — admin full; teacher read+reports; accountant
   read+fines+reports. All tenant-scoped.

## N. Transport ✅ (Phase D)
1. Add **vehicles** (insurance/fitness/permit expiry, capacity) and **drivers**
   (license + expiry + helper); build **routes** (assign a vehicle + driver) and
   ordered **stops** (pickup/drop times, zone, distance).
2. **Allocate** students to a route + stop (school + college students). Map a
   **route- or stop-level transport fee** (stop overrides route) and **generate
   transport invoices** into the Fees module — idempotent per student/period.
3. Optional **trip log** (one pickup + one drop per route/day:
   scheduled/completed/cancelled). Reports (Reports Center): route-/stop-wise
   students, vehicle & driver lists, transport fee dues, route occupancy/capacity,
   and document **expiry** (insurance/fitness/permit/license). Permissions:
   `transport:read|create|update|delete|allocate|fees|reports` — admin full;
   teacher read+reports; accountant read+fees+reports. Tenant-scoped; the portal
   exposes a student's own allocation (owner-scoped). ⬜ live location feed.

## O. Hostel ✅ (Phase D)
1. Define **hostels** (type, warden), **blocks**, and **rooms** (floor, type,
   capacity, status: available/occupied/maintenance/inactive).
2. **Allocate** a student to a room/bed (school + college) — capacity enforced,
   one active allocation per student, one occupant per bed; **transfer** between
   rooms and **vacate** keep history (active/vacated/transferred).
3. Map a **hostel- or room-type-level fee** (room type overrides hostel) and
   **generate hostel invoices** into the Fees module (idempotent per
   student/period). Reports (Reports Center): hostel students, room allocation,
   occupancy/vacancy, fee dues, vacated history, maintenance rooms. Permissions:
   `hostel:read|create|update|delete|allocate|fees|reports` — admin full; teacher
   read+reports; accountant read+fees+reports. Tenant-scoped; the portal exposes a
   student's own allocation (owner-scoped).

## P. Inventory ✅ (Phase D)
1. Define **item categories**, **items** (unit, opening/min stock, location), and
   **vendors**. Record **purchases** (stock-in, multi-line, optional document
   attachment) — stock increases.
2. **Issue** stock (stock-out) to department/staff/student/event — stock
   decreases and **insufficient stock is rejected**. **Adjust** stock
   (damage/lost/correction, signed) with a non-negative guard.
3. `current_stock` is an authoritative running balance updated transactionally;
   every change writes a **stock-movements** ledger row (change + resulting
   balance) for audit. Reports (Reports Center): stock register, low stock,
   purchases, issues, vendor-wise purchases, item movement history, damaged/lost.
   Permissions: `inventory:read|create|update|delete|purchase|issue|adjust|
   reports` — admin full; accountant read+purchase+reports; teacher read+reports.
   Tenant-scoped.

## Q. Payroll ✅ (Phase D)
1. Define **salary components** (earnings/deductions, fixed or % of basic) and
   assign per-staff **salary structures** (a new one supersedes the active → kept
   as revision history).
2. **Run** monthly payroll: it pulls the staff-attendance/leave summary (working/
   present/absent/paid+unpaid leave), computes gross/deductions/net, and auto-adds
   an **unpaid-leave deduction** (per-day of gross × unpaid days). Runs are
   idempotent per staff/month (recalc needs `payroll:update`); **finalize** locks
   the run + payslips and blocks re-runs.
3. **Payslip PDFs** (pdfkit) are owner-scoped — staff download only their own
   (`/payroll/payslips/mine`); admin/accountant download any. Reports (Reports
   Center): payroll register, staff-wise salary, deductions, payslip status,
   attendance vs payroll, unpaid-leave deductions. Permissions: `payroll:read|
   create|update|delete|run|finalize|payslip|reports` (admin full; accountant all
   but delete; teacher = own payslip). Tenant-scoped.

## R. Reports 🟡
1. Each module exposes list/summary views ✅ where built.
2. ✅ A **Reports Center** offers 55 cross-module reports with filters and
   **CSV/PDF export + print** (`/report-center`), permission-gated + tenant-scoped
   — incl. 6 **college**, 6 **library**, 7 **transport**, 6 **hostel**, 7
   **inventory**, 7 **staff-attendance/leave**, and 6 **payroll** reports (register,
   staff-wise salary, deductions, payslip status, attendance-vs-payroll, unpaid leave).
3. ✅ **Custom Report Builder** (`/custom-reports`, `custom_reports:*`,
   tenant-scoped). Over the Reports Center registry a user can:
   - **Ad-hoc**: pick a source, preview it to discover columns, choose columns +
     reusable filters (date range, class/section, status, category, search) + sort,
     and **export CSV/PDF** without saving (`POST /preview`, `POST /export`).
   - **Saved definitions**: persist the above as a named report (run/edit/
     duplicate/delete; `GET|POST|PATCH|DELETE /:id`, `POST /:id/duplicate`,
     `GET /:id/run`, `GET /:id/export`). Each is **private** (creator-only, no
     existence leak) or **shared** (visible to others with `custom_reports:read`);
     sharing requires `custom_reports:share`, so accountants can create but not
     share. Creator or an admin may edit/delete.
   - **Access is never widened**: running, previewing or exporting re-checks the
     *underlying* report's own permission (e.g. a fee report still needs
     `fee_reports:read`), everything is tenant-scoped (no cross-institution), and
     students/parents have no `custom_reports` permissions at all. Permissions:
     `custom_reports:read|create|update|delete|run|export|share` — admin full;
     accountant all except `share`; teacher read/run/export.
   *(⬜)* Scheduled reports.

## S. College mode ✅ (Phase B)
1. Admin sets the institution to **college** mode (`PATCH /college/settings`,
   `college:update`); the school flow is unchanged and college data only appears
   for college tenants.
2. Build the structure: **departments** → **programs/courses** (duration in
   semesters) → **semesters** (+ optional **batches**). Map **subjects** to a
   program/semester with **credits** (`program_subjects`).
3. **Enroll** students into a program (+ current semester/batch); **allocate**
   teachers to a department/program/subject. All tenant-scoped and
   permission-guarded (`departments:*`, `programs:*`, `semesters:*`, `college:*`).
4. **Results:** create exams tagged to a semester (`exams.semester_id`) and enter
   marks as usual. The **GPA/CGPA** foundation weights each subject's grade point
   (`grade_bands.grade_point`) by its credits → per-semester GPA and cumulative
   CGPA, read **owner-scoped** at `/college/students/:id/semesters/:id/result`
   and `/college/students/:id/cgpa` (student→self, parent→child, staff→any).
5. **Fees/timetable:** fee structures may target a program/semester; a timetable
   entry targets a section (school) **or** a semester (college).

## T. Online Fee Gateway ✅ (Phase D)
1. **Configure (optional):** set `PAYMENT_GATEWAY_PROVIDER` +
   `PAYMENT_GATEWAY_WEBHOOK_SECRET` (env, never committed). When unset the gateway
   is "not configured" — `POST /online-payments` returns 503 and **offline fee
   collection is unaffected**. An admin can also toggle online payments per
   institution via `PATCH /online-payments/settings` (`online_payments:settings`;
   stored as a `featureFlags.onlinePayments` flag). `GET /online-payments/settings`
   shows status (provider/enabled) and **never returns secret keys**.
2. **Initiate:** an admin/accountant, or a **student/parent for their own/linked**
   invoice (owner-scoped), calls `POST /online-payments { invoiceId }`
   (`online_payments:create`). The server charges the invoice's **outstanding
   balance** (a mismatching client `amount` is rejected — anti-tampering),
   refuses an invoice that already has a successful payment, creates a
   `payment_orders` row, and returns a **hosted checkout URL** to redirect to.
3. **Webhook:** the provider calls `POST /online-payments/webhook` (public). The
   raw body's **HMAC-SHA256 signature is verified**; the event is **idempotent**
   (`payment_webhook_events` unique per provider+event id). On `success` it locks
   the order, credits the invoice via the normal `payments` ledger (`method =
   online`), marks the order `success`, and links the created payment — so the
   existing **fee-receipt PDF** is available at `/online-payments/:id/receipt`.
   `failed`/`cancelled`/`expired` update the order without crediting. Only the
   matched order's institution is touched — no cross-tenant data is read/written.
4. **Manage:** admin/accountant can **refund** a successful order
   (`POST /online-payments/:id/refund`, `online_payments:refund`; gateway-initiated,
   reconcile the fee ledger separately). Reports (Reports Center,
   `online_payments:reports`): transactions, successful, failed/cancelled, pending
   orders, and **gateway reconciliation** (order vs credited amount). The Super
   Admin cross-tenant snapshot includes per-institution successful-payment totals.

## U. Transfer Certificates ✅ (Phase D)
1. Office staff create a **TC draft** (`transfer_certificates:create`) for a
   student → an atomic, collision-free **TC number** (dedicated sequence, like
   admission numbers) is assigned and the student's class/section/program/
   semester/admission-no are **snapshotted** so the record stays faithful.
2. Before issuing, a **dues check** (`/transfer-certificates/student/:id/dues`)
   surfaces pending **fees, library, transport and hostel** dues.
3. **Issue** (`:issue`): blocked when dues exist unless the caller passes an
   explicit **override** with a reason AND holds `transfer_certificates:
   override_dues` (admin) — accountants can issue dues-free TCs but not override.
   Issuing snapshots the dues status, stamps the issue date, and flips the
   **student to `transferred`** (no data is deleted; records/fees/history remain).
4. **Cancel** (`:cancel`): the TC stays in the register but is invalid (its PDF
   is watermarked CANCELLED).
5. **PDF** (`:download`): institution name/logo, student + guardian details, DOB,
   joining/leaving dates, reason, conduct, academic year, TC number, dues status,
   and signature placeholders; re-downloadable after issue. Owner-scoped —
   a student/parent can download only their own / linked child's **issued** TC.
6. **Reports** (Reports Center, `transfer_certificates:read`): TC issued register,
   cancelled TCs, student-leaving report, pending/draft TCs. Tenant-scoped
   throughout; cross-institution access is denied.

## V. Disciplinary Records ✅ (Phase D)
1. Staff **log an incident** (`/disciplinary`, `disciplinary:create`) for a
   school or college student: incident date, **category**, **severity**
   (low/medium/high/critical), description, reported-by, involved staff,
   optional action + follow-up. The student's class/section or program/semester
   is **snapshotted** at creation; every record opens an **audit timeline**.
2. **Lifecycle** (each step appends to the timeline): edit details
   (`disciplinary:update`, blocked once terminal) → **mark under review** and
   **record action taken** (`disciplinary:action`, moves to `under_review` /
   `action_taken`) → **close** (`disciplinary:close`) or **cancel** if entered
   wrongly (`disciplinary:delete`, retained for audit). A hard **delete** also
   needs `disciplinary:delete`. Closed/cancelled records are immutable.
3. **Student history** (`/disciplinary/student/:id`) lists a student's incidents
   for staff. `GET /disciplinary/:id/actions` returns the audit trail.
4. **Portal (safe default OFF)**: students/parents read **only their own /
   linked child's** records via `/portal/students/:id/disciplinary`, and only
   when (a) an admin has enabled portal visibility (`PATCH /disciplinary/settings`,
   an institution feature flag) AND (b) the caller holds `disciplinary:portal_read`
   AND (c) the student is owner-accessible — otherwise 403. Staff endpoints are
   permission-based; students/parents (who hold only `portal_read`) and
   unprivileged staff (e.g. accountant) are blocked from the admin register, so
   sensitive records never leak.
5. **Reports** (Reports Center, `disciplinary:reports`): incident register,
   student-wise history, category-wise, severity-wise, open/pending, and
   action-taken. Permissions: `disciplinary:read|create|update|delete|action|
   close|reports|portal_read` — admin full; teacher read/create/update/action/
   reports. Tenant-scoped; cross-institution access is denied.
