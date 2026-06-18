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

## B. Super Admin onboarding ⬜
1. Super Admin creates an **institution** (school|college) + first **branch**.
2. Assigns a **subscription package** (limits/features).
3. Creates the institution's first **admin** user.
4. Institution Admin logs in → scoped entirely to that `institution_id`.
5. Super Admin can view global **audit logs**, trigger **backups**, switch tenant.

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
4. *(⬜)* Staff attendance, leave requests/approval, timetable, payroll, reviews.

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

## H. Fee management 🟡
1. Accountant defines **fee structures** (class/year, amount, frequency).
2. Generates **invoices** per student → unique invoice number, status `pending`.
3. Records **payments** → server **rejects overpayment**, advances status
   `pending → partially_paid → paid`.
4. `GET /fees/summary` → collected vs pending KPIs.
5. ✅ Payment **receipt PDF** (owner-scoped). *(⬜)* Fee categories, term schedules,
   **fines**, **discounts/scholarships**, **online gateway** adapter, dues reports.

## I. Communication ✅
1. Admin/Teacher posts an **announcement** with **audience** + optional **pin**.
2. Clients list audience-filtered, pinned-first.
3. ✅ **In-app messaging**: compose to an audience (all students/parents, staff,
   class, section, individual) → per-recipient inbox with read/unread; staff see
   sent history + read counts. **email/SMS/FCM** fan-out (best-effort, optional).
4. ✅ **Fee reminders** (outstanding invoices) and **absence alerts** (absentees,
   de-duplicated per student/day) to students + guardians.
5. *(⬜)* Threaded 1:1 messaging, scheduled campaigns.

## J. AI assistant ✅ / ⬜ advanced
1. Staff asks a question → `POST /ai/assistant`.
2. Service injects **live KPIs** into the system prompt, calls **GPT-4o**, saves
   the turn to Mongo; returns the answer (history via `/ai/conversations`).
3. *(⬜)* Report summaries, **attendance-risk alerts**, fee-pending summaries,
   **embeddings document search**, workflow suggestions.

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

## M. Library ⬜ (Phase D)
1. Librarian adds **books** + copies (catalogue).
2. **Issue** to member (student/staff) with due date → **return** → auto **fine**
   if late.
3. Member history + stock report.

## N. Transport ⬜ (Phase D)
1. Add **vehicles**, **drivers**, **routes** + stops.
2. Allocate students to routes; **map transport fee → invoices**.
3. Route-wise reports; optional live location feed to parent app.

## O. Hostel ⬜ (Phase D)
1. Define **hostels** + **rooms** (capacity).
2. Allocate students; **map hostel fee → invoices**; occupancy report.

## P. Inventory ⬜ (Phase D)
1. Add **items** + **vendors**; record **purchases** (stock in).
2. Record **issues** (stock out); stock-level report.

## Q. Payroll ⬜ (Phase D)
1. Define **salary structures** (allowances/deductions).
2. Run monthly **payroll** (factor staff attendance/leave) → **payslip PDF**.
3. Salary register / reports.

## R. Reports 🟡
1. Each module exposes list/summary views ✅ where built.
2. ✅ A **Reports Center** offers 16 cross-module reports with filters and
   **CSV/PDF export + print** (`/report-center`), permission-gated + tenant-scoped
   — incl. 6 **college** reports (departments, programs, semester students,
   semester attendance, semester results, program fee dues).
   *(⬜)* Scheduled reports + a **custom report builder** (saved definitions).

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
