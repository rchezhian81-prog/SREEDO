# Tenant Admin — Per-Module Manual Smoke-Test Plan

> **Status: PLANNING ONLY.** These are manual QA checklists, mirroring the
> per-module smoke plans used for the Super Admin suite. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` — module names, order, and ✅/🟡/⬜ verdicts
> are taken from its §3 table and must stay consistent with it. Nothing here
> claims a module works; each checklist is what you **run** to prove it does.

## How to run

**Environment.** Bring the stack up (`docker compose up --build`, web on `:80`,
Swagger at `/api/docs`, health at `/health`). The seed creates **one** institution
— `SRE Demo School` (type `school`) — with admin **`admin@sreedo.edu` /
`Admin@12345`** (`backend/src/db/seed.ts`).

**You need two tenants and both editions.** Set up before testing:
- **Tenant A** — the seeded `SRE Demo School` (school mode).
- **Tenant B** — create a **second institution** via the Super Admin console
  (Tenants → create), with its own admin login. Isolation tests are impossible
  with one tenant.
- **A college edition** — either make Tenant B type `college` at creation, or on a
  throwaway tenant switch mode via `PATCH /college/settings { "type": "college" }`
  (admin only; needs `college:update`; busts the type cache). Keep at least one
  school **and** one college tenant available.

**Accounts for RBAC-negative checks.** In each tenant, via the Users module,
create one **teacher** and one **accountant** login (and, for portal checks, keep
a seeded **student/parent**). RBAC-negative steps log in as the *wrong* role and
expect **403**, proving guards are server-side, not just hidden nav.

**Legend / step flags.**
- **✅ regression-smoke** — module verdict Completed; run the checklist as a
  regression pass.
- **🟡 build-then-smoke** — Partial; run the ✅ parts now, the rest after the
  roadmap PR builds them.
- **⬜ build-then-smoke** — Missing; checklist is the acceptance test for when it's
  built.
- **⚠️ production-risk step** — money, deletes, bulk writes, or external sends; do
  on disposable data only.
- **🏢 isolation step** — repeat on Tenant B (or attack cross-tenant) to prove no
  leakage.
- **🔒 RBAC-negative step** — a non-permitted role must get **403**.

Run every module in **both** a school and a college tenant unless noted.

---

## Per-module checklists (master-roadmap §3 order)

### 1. Tenant Dashboard / Overview — ✅ 🎨
1. Log in as admin; `/dashboard` renders stats + charts without console errors.
2. 🔒 Log in as teacher/accountant — confirm staff-gated stats endpoints
   (`dashboard/stats`, `/charts`) return only permitted data, not 500s.
3. 🏢 Compare Tenant A vs Tenant B dashboards — **counts must differ**; no
   Tenant B numbers appear for Tenant A.
4. **Shell-honesty (known mock chrome, §4.4):** note the hardcoded notification
   "5", messages "3", "2026–2027" session pill, and the dead global search —
   these are **not live**; flag them, don't sign them off as working.
5. Toggle dark mode — dashboard cards must not break (hub pages use light-only
   colors; log any that do).

### 2. Academic Setup — ✅
1. Create academic year, class, section, subject; assign class-subjects.
2. 🔒 As teacher, attempt to create a class → expect 403 (`academics:create`).
3. 🏢 **Re-scoping regression:** in Tenant B create academic year **"2025-2026"**,
   class **"Grade 1"**, subject code **"MATH101"** — must **succeed** even though
   Tenant A has the same (see Tenant Isolation regression §I).
4. ⚠️🏢 In college mode, confirm class/section creation is **blocked**
   (`requireInstitutionType('school')` → 403) and the college academic block is
   used instead (module 2-college below).
5. Delete a section with no dependents; confirm FK-safe behaviour.

### 2-college. College Academic Setup — ✅ (`/college/*`)
1. In a college tenant: create Department → Program → Semester → Batch; map a
   subject to a program/semester **with credits**.
2. 🔒 As teacher, attempt `POST /college/departments` → 403
   (`departments:create`); `GET` should succeed (read granted).
3. 🏢 As a **school** tenant, hit `/college/departments` → **403 "only available
   for college"** (`requireInstitutionType('college')`, `college.routes.ts:82`).
4. Enroll a student into a program/semester; confirm it appears in Enrollments.
5. ⚠️ Duplicate department code in the same tenant → **409**; same code in another
   tenant → allowed (per-tenant `UNIQUE(institution_id, code)`).

### 3. Student Management — ✅
1. Create, edit (`PATCH /students/:id`), and soft-delete a student; add an inline
   guardian with relationship + Profile-v2 demographics.
2. ⚠️ Import a CSV (dry-run/validation first, then commit); confirm row-level
   errors surface before write.
3. ⚠️ Run bulk promotion / year-rollover (`POST /students/promote`) on disposable
   data; confirm target sections update.
4. 🔒 As teacher, attempt student create/delete → 403 (write is admin/office).
5. 🏢 **Admission-no regression:** Tenant B creates admission **"ADM001"** —
   must succeed despite Tenant A having it (per-tenant sequence/uniqueness).
6. 🏢 Attempt to fetch a Tenant B student UUID while logged into Tenant A →
   must **not** echo the name/label (in-tenant `section_id`/FK validation, §4.1).

### 4. Admissions / Enquiry — ✅
1. Submit a **public** enquiry (unauthenticated endpoint); confirm it lands.
2. Convert application → student; verify the student now exists in Students.
3. 🔒 As teacher, attempt to convert/approve → 403 if admin-gated.
4. 🏢 Confirm Tenant A cannot list Tenant B's applications.
5. Reject/withdraw an application; confirm status machine transitions.

### 5. Attendance — ✅ ⚠ (HIGH isolation history)
1. Mark daily attendance for a section (`POST /attendance`,
   `authorize("admin","teacher")`); reload and confirm persisted.
2. 🔒 As **accountant/student**, `POST /attendance` → **403**.
3. ⚠️🏢 **Cross-tenant `bulkMark` regression (the §4.1 HIGH bug).** As Tenant A
   admin, call bulk-mark with a **Tenant B student UUID**. **Expected after the
   T0 hardening PR:** rejected / no-op (in-tenant student check). **If it
   overwrites Tenant B's row, the bug is present** — `attendance.service.ts`
   `ON CONFLICT (student_id, date)` on a globally-unique key. This is the single
   most important isolation step in the suite.
4. View a student's attendance history + summary; numbers reconcile.
5. **College:** exercise **period/hour attendance** (`period_attendance`) as the
   college-default granularity; confirm subject-wise marking works.
6. 🏢 Confirm daily-attendance list for Tenant A never includes Tenant B students.

### 6. Fees / Collections — ✅
1. Create a fee structure, generate an invoice, record a payment; ⚠️ verify
   ledger/receipt totals (money — disposable data only).
2. ⚠️ Apply a discount and a fine; confirm invoice recomputes.
3. ⚠️ Process a refund (`feerefunds`); confirm reversal in the ledger.
4. **Online payment:** start an order → checkout → webhook; confirm the gateway
   adapter is a **stub/simulated** (master-roadmap §4.5) and degrades gracefully
   when unconfigured.
5. 🔒 As teacher, attempt invoice create/payment → 403 (accountant/admin only).
6. 🏢 Attempt to create an invoice for a **Tenant B `studentId`** → must be
   rejected (ownership check, §4.1); confirm no cross-tenant invoice.

### 7. Exams / Marks / Results — ✅
1. Create an exam, enter marks, generate a report card / mark sheet.
2. Configure grade bands; confirm grade mapping on the report card.
3. 🔒 As teacher, confirm marks entry is **scoped** to assigned classes; a
   non-assigned class write is blocked.
4. 🏢 `upsertResults` with a **Tenant B student/subject UUID** → must not
   echo/leak (in-tenant check, §4.1).
5. **College:** exam with `semester_id`; confirm GPA/CGPA path
   (`/college/students/:id/result`,`/cgpa`) and `grade_point` grade sheet.
6. 🔒 Fetch another student's college result as a student portal user → **403**
   (owner-scoped `assertStudentAccess`).

### 8. Timetable — ✅
1. Build a timetable; add a clashing entry → clash detected/blocked.
2. Run the greedy generator (`timetablegen`); review output.
3. ⚠️ Export CSV; confirm structure.
4. **College:** create a **semester-targeted** entry (`semester_id`); confirm the
   `section_id IS NOT NULL OR semester_id IS NOT NULL` "one-of" holds.
5. 🏢 Confirm Tenant A timetable never shows Tenant B periods.

### 9. Staff / HR — 🟡 (build-then-smoke: non-teaching staff master)
1. ✅ Staff attendance + staff leave (`staffleave`) works today — mark leave,
   approve, check balances.
2. ✅ Payroll: run a cycle on disposable data; ⚠️ verify amounts.
3. ⬜ **Once built:** create a **non-teaching staff** record in the new Staff
   master (today `teachers` is overloaded) — confirm it is not a "teacher".
4. 🔒 As teacher, attempt payroll run → 403.
5. 🏢 Confirm staff/payroll rows never cross tenants.

### 10. Teacher / Faculty Management — ✅
1. Create, edit, import teachers; hit the plan-limit and confirm the cap message.
2. 🔒 As teacher, attempt to create another teacher → 403.
3. **College:** confirm the label reads **"Faculty"** (nav + `useTerms`).
4. 🏢 Tenant A cannot see Tenant B faculty.

### 11. Parent / Student Portal readiness — ✅ (reference track)
1. Log in via the portal cookie flow as a seeded student/parent.
2. Confirm the aggregator returns **only that student's** data (owner-scoped).
3. 🔒 Manipulate a child/student id in a portal call → **403**, not another
   family's data.
4. 🏢 Confirm no cross-tenant portal access.

### 12. Communication / Announcements — ✅
1. Post an announcement; confirm targeted audience sees it.
2. ⚠️ Send an in-app + email/SMS/push message (providers optional — confirm
   **graceful degrade** when SMTP/SMS unconfigured, not a 500).
3. Start a thread/reply; confirm delivery + generated alerts.
4. 🔒 As a role without comm permission, attempt a broadcast → 403.
5. 🏢 Confirm Tenant A cannot message Tenant B recipients.

### 13. Documents / Certificates — ✅
1. Generate a fee receipt, an ID card, and a certificate PDF.
2. ⚠️ Issue a Transfer Certificate — confirm it is **dues-gated** (blocked with
   outstanding fees).
3. 🔒 As teacher, attempt TC issue → 403 if office/admin-gated.
4. 🏢 Confirm a document references only in-tenant records.

### 14. Transport — ✅
1. Create a route, allocate a student, generate the transport fee → invoice.
2. Log a trip; confirm it records.
3. ⚠️ Confirm transport fee flows into the fees/ledger correctly (money).
4. 🏢 Isolation: routes/allocations never cross tenants.

### 15. Hostel — ✅
1. Create hostel structure; allocate a bed (confirm the `FOR UPDATE` lock
   prevents double-allocation — attempt a concurrent allocate).
2. Generate hostel fees.
3. 🔒 As teacher, attempt allocation → 403 if gated.
4. 🏢 Isolation check.

### 16. Library — ✅
1. Issue and return a book (confirm `FOR UPDATE SKIP LOCKED` circulation).
2. Place and fulfil a reservation.
3. ⚠️ Apply an overdue fine; confirm it posts.
4. 🏢 Isolation: catalogue/circulation per tenant.

### 17. Inventory — ✅
1. Record stock in / out / adjust; confirm the ledger balance.
2. ⚠️ Drive stock negative → must be **guarded/blocked**.
3. 🏢 Isolation: stock never crosses tenants.

### 18. Front Office — 🟡 (build-then-smoke: unification)
1. ✅ Log a visitor and check them out (`visitors`).
2. ✅ File a complaint / lost-found entry (exist separately today).
3. ⬜ **Once built:** confirm the **unified** front-office surface ties
   visitors + enquiry + complaints + lost-found (+ postal/call register).
4. 🏢 Isolation across all front-office entities.

### 19. Calendar / Events — ✅
1. Create an event with filters; confirm it renders on the calendar.
2. 🔒 As a read-only role, attempt create → 403.
3. 🏢 Isolation: events per tenant.

### 20. Homework / Assignments — ✅ 🟡 (school-only shape)
1. ✅ **School:** create homework for a **section**, submit as student, grade it;
   full lifecycle.
2. ⬜ **College (must build):** attempt to create homework in a college tenant —
   today it **requires `sectionId`** (`homework.schema.ts:4`, `section_id NOT
   NULL`) so college has no valid target. Confirm the gap; the acceptance test is
   creating homework against a **semester/program** once the additive variant
   lands (see `SCHOOL-COLLEGE-DIFFERENCES.md` §6).
3. 🔒 As student, attempt to create (not submit) homework → 403.
4. 🏢 Isolation: homework/submissions per tenant.

### 21. PTM / Parent Meetings — ⬜ (build-then-smoke)
1. ⬜ **Once built:** schedule a meeting with slots; confirm slot booking.
2. ⬜ Send invites; parent receives + confirms a slot.
3. ⬜ Record attendance + meeting notes.
4. 🔒 Non-permitted role blocked from scheduling.
5. 🏢 Isolation of meetings/slots per tenant. *(Today only
   `calendar_events.type='meeting'` exists — nothing to smoke yet.)*

### 22. Discipline / Behaviour — ✅
1. File a disciplinary entry; move it through the status machine.
2. Confirm the audit trail records each transition.
3. Toggle the portal-visible flag; confirm parent visibility respects it.
4. 🔒 As teacher, confirm scoped access; 🏢 isolation per tenant.

### 23. Leave Management — ✅ 🟡
1. ✅ **Staff leave** (`staffleave`): request → approve/reject; balances update.
2. ⬜ **Student leave (must build):** apply as student → approval → attendance
   integration. Acceptance test for the new module.
3. 🔒 As a peer without approval rights, attempt to approve → 403.
4. 🏢 Isolation: leave records per tenant.

### 24. Reports / Analytics — ✅ 🎨
1. Open Report Center (~80 reports); run one with filters; ⚠️ export **CSV/PDF**.
2. Build a custom report (Report Builder); save + re-run.
3. Schedule a report (`scheduledreports`); confirm it queues.
4. **IA note (§4.4):** four overlapping nav entries (Reports, Reports Center,
   Report Builder, Scheduled Reports) — flag for consolidation, don't fail.
5. ⚠️🔒 A sensitive export (student PII / fees / payroll) must be **reason-gated +
   audited**; a non-permitted role → 403.
6. 🏢 Every report returns **only** the caller's tenant rows.

### 25. Settings / Branding / Academic Year — 🟡 (build-then-smoke: unified Settings)
1. ✅ Edit branding (logo/display name/tagline); confirm it re-renders the shell.
2. ✅ CRUD an academic year.
3. ⚠️ Switch mode via `PATCH /college/settings` (admin) — confirm nav/terminology
   flip and the type-cache busts immediately.
4. 🔒 As teacher, attempt the mode switch → 403 (`college:update`).
5. ⬜ **Once built:** a **unified tenant Settings** home (profile read, academic
   year, branding, module toggles, mode, notification prefs) with the **three
   mode sources reconciled to one** (`SCHOOL-COLLEGE-DIFFERENCES.md` §2).
6. 🏢 Branding/settings never bleed across tenants.

### 26. Tenant Admin User Management — ✅
1. Create a staff login; deactivate + reactivate it.
2. Reset 2FA; unlock a locked account (`users:manage`).
3. 🔒 As teacher, attempt user create/deactivate → 403.
4. 🏢 Tenant A cannot see or edit Tenant B users.

### 27. Tenant-side RBAC — 🟡 (build-then-smoke: per-tenant matrix)
1. ✅ Assign an existing fixed role (admin/teacher/accountant) to a user; confirm
   the permission takes effect immediately.
2. ✅ Confirm a permission-gated endpoint respects the grant server-side.
3. ⬜ **Once built:** a **per-tenant** role/permission editor + finer job-roles as
   permission-sets (Principal, Exam Controller, HOD, Librarian, …) — today the
   matrix is a **single global** table editable only from the platform console.
4. 🔒🏢 Critically: a grant change in Tenant A must **not** affect Tenant B
   (today it would — that's the gap this module fixes).

### 28. Import / Export — 🟡 (build-then-smoke: unified center)
1. ✅ Import students and teachers (the only two importers today) with dry-run +
   row errors.
2. ✅ Export a few modules' CSV/PDF individually.
3. ⬜ **Once built:** a unified tenant Import/Export center beyond
   students+teachers, with reason-gated + audited sensitive exports.
4. ⚠️🔒 Sensitive export requires reason + audit; non-permitted role → 403.
5. 🏢 Import cannot inject rows into another tenant; export returns own-tenant only.

### 29. Audit / Activity Log — ✅
1. Perform create/update/delete/approve/export actions; confirm each is logged.
2. Confirm the log is **own-tenant forced** (Tenant A sees only its events).
3. ⚠️ Stop MongoDB and repeat — the module must **degrade gracefully** (no 500;
   Mongo is optional), per master-roadmap.
4. 🔒 As non-admin, confirm the activity log is not readable.

### 30. Help / SOP for Tenant Admin — ⬜ (build-then-smoke)
1. ⬜ Today the `help` module is **platform-only** — a tenant admin hitting it
   gets **403** (`help:read` never granted to tenant roles). Confirm the 403.
2. ⬜ **Once built:** a tenant-facing Help/SOP surface (reuse the Super-Admin
   curated-docs pattern, tenant-scoped perms) — confirm a tenant admin can read
   SOPs; 🔒 a student/parent cannot.
3. 🏢 Curated content is tenant-appropriate (no platform-only SOPs leak in).

---

## I. Tenant Isolation regression (run every release) — 🏢

The application enforces isolation **in code only** (no Postgres RLS), so this
suite is mandatory. Use **Tenant A** (seeded school) and **Tenant B** (second
institution). All steps expect **no cross-tenant visibility or write**.

1. **Invisibility sweep.** Create distinctive data in Tenant A (a student, an
   invoice, an exam, an announcement). Log in as Tenant B admin. Confirm **none**
   of it is listable, searchable, or fetchable by id.
2. **Cross-tenant `bulkMark` fix (the §4.1 HIGH).** As Tenant A admin, call daily
   attendance bulk-mark supplying a **Tenant B student UUID + a date**. Log in as
   Tenant B and inspect that student's attendance for that date. **Pass:** the
   row is unchanged (Tenant A's call rejected/ignored via the in-tenant student
   check). **Fail:** Tenant B's attendance was overwritten (the pre-fix
   `ON CONFLICT (student_id,date)` global-key bug). Re-run after any attendance
   change.
3. **Per-tenant namespace regressions (prove the re-scoping fix).** Confirm **both**
   tenants can independently create, with no collision:
   - Academic year **"2025-2026"** in both.
   - Class **"Grade 1"** in both.
   - Subject code **"MATH101"** in both.
   - Admission no **"ADM001"** in both (per-tenant sequence).
   - Employee no + invoice no sequences advance **per tenant**, not globally.
   **Pass:** all succeed independently. **Fail:** a global `UNIQUE`/sequence
   rejects the second tenant (the pre-fix bug).
4. **FK-echo leak checks.** From Tenant A, submit a **Tenant B** `studentId` /
   `sectionId` / `subjectId` to: student create, invoice create
   (`fees.createInvoice`), `exams.upsertResults`, `academics` counts. **Pass:**
   rejected with no name/label echoed back. **Fail:** the foreign record's data
   is reflected.
5. **Guard bypass attempts.** Strip/forge the tenant context on a few writes;
   confirm `requireTenant` + owner-scope reject, never fall through to another
   tenant.
6. **Super-admin bypass sanity.** Confirm `super_admin` legitimately crosses
   tenants (by design) but a tenant admin never can.

## II. School vs College (run on a school **and** a college tenant) — 

Exercises the `SCHOOL-COLLEGE-DIFFERENCES.md` model.

1. **Mode switch.** As admin, `PATCH /college/settings { type: "college" }`.
   Confirm `/auth/me.institutionType` flips, the client `mode` reconciles
   (`layout.tsx`), and the type cache busts (no 60 s stale window).
2. **Nav swap.** In college mode the sidebar **replaces `/classes`** with the
   7-item college block (College Home, Departments, Programs, Semesters,
   Subjects, Enrollments, Results) and **relabels Teachers → Faculty**. Switch
   back to school and confirm it reverts.
3. **Terminology.** On the ~20 adopted pages, confirm college nouns
   (Faculty/Program/Batch/Course/Semester/Registration No/Grade Sheet). **Note
   the ~100 not-yet-adopted pages** still show school nouns — expected gap, log
   it (master-roadmap §4.3).
4. **College academic flow.** Department → Program → Semester → Batch → map
   subject+credits → enroll student → view GPA/CGPA grade sheet. All succeed.
5. **Type gating.** School tenant hitting `/college/*` structure routes → **403**;
   college tenant creating a class/section → **403**
   (`requireInstitutionType`).
6. **Additive-column academics.** Confirm exams (`semester_id`), fees
   (`program_id`/`semester_id`), and timetable (`semester_id`, "one-of" check)
   accept college targets — and that **homework does not yet** (school-only
   `section_id`, the known build item).
7. **Copy honesty.** Flag any literal "school" wording shown to a college tenant
   (analytics/dashboard/branding).

---

*Cross-references: `TENANT-ADMIN-MASTER-ROADMAP.md` §3 (verdicts) & §4.1
(isolation), `SCHOOL-COLLEGE-DIFFERENCES.md` (§II here), `TENANT-ADMIN-DATA-MODEL.md`
(re-scoping detail), `P0-MVP-SCOPE.md` (what T0 hardening must pass before these
regressions go green).*
