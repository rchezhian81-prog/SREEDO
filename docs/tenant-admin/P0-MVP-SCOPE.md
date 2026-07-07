# Tenant Admin — P0 MVP Scope ("Trustworthy Multi-Tenant Core")

> **Status: PLANNING ONLY.** No code, no migrations, no deployment. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` (canonical) and `MODULE-SEQUENCE.md`. This doc
> defines the **absolute must-have** Tenant Admin MVP and draws the P0 / not-P0 line.
> All statuses (✅/🟡/⬜/🎨) and fixes are quoted from the master roadmap (§3, §4.1,
> §5, §9); this doc never re-verdicts a module.

---

## 1. What "P0" means here

The master inventory (master §1) found the tenant MVP **already largely exists** —
23/30 modules Completed, ~120 pages, 56 routers with real logic. So P0 is **not**
"build the MVP." P0 is:

> **The existing core modules PLUS the correctness/security fixes that make them
> safe to run for multiple real tenants at once.**

A demo with one tenant already works. **P0 is the smaller, harder thing: the point at
which two *real* paying tenants (one school, one college) can run the full core loop
concurrently with no cross-tenant leakage, collision, or fabricated data.** That is
why P0 is dominated by the master §4.1 hardening (PR-T0), not by new screens.

**P0 in one line:** *core modules already ✅ + PR-T0 isolation fixes + shell honesty =
a multi-tenant core you can trust with two live tenants.*

---

## 2. P0 module scope (the brief's P0 list, reconciled to the live code)

For each brief-P0 item: master module + verdict, what's **IN** P0, what's
**DEFERRED**, and the **P0 fix** required (if any). "P0 fix" items are all inside
**PR-T0** unless noted.

| # | Brief P0 item | Master module · verdict | Included in P0 | Deferred (not P0) | P0 fix required |
|---|---|---|---|---|---|
| 1 | Academic-year setup | M2 Academic Setup · ✅ | Year CRUD + set-current; both school & college shells | — | Re-scope `academic_years.name` global UNIQUE → `UNIQUE(institution_id,name)` (§4.1) |
| 2 | Class/section **OR** dept/program/batch/semester | M2 Academic Setup · ✅ | School: classes/sections/subjects/class-subjects. College: dept/program/semester/batch | Deep `class_subjects` UI (thin surface OK) | Re-scope `classes.name`, `subjects.code` global UNIQUE → per-tenant (§4.1) |
| 3 | Student admission / profile | M3 Students · ✅ (+ M4 Admissions ✅) | Student CRUD + import + promote + guardians + Profile-v2; create/admit with admission-no; enquiry→convert pipeline available | Co-curricular; **student leave** (🔭/⬜) | In-tenant `section_id` FK validation; re-scope `students.admission_no` UNIQUE + `student_admission_seq` → per-tenant (§4.1) |
| 4 | Staff / teacher profile | M10 Teacher ✅ **P0**; M9 Staff/HR 🟡 **P1** | Teacher CRUD + import + plan-limit | **Non-teaching Staff master** (🟡→Phase 4); recruitment/appraisal/onboarding (🔭); substitute-teacher (🔭) | Re-scope `teachers.employee_no` UNIQUE + `teacher_employee_seq` → per-tenant (§4.1) |
| 5 | Tenant admin users / roles | M26 Users ✅; M27 Tenant-RBAC 🟡 | User CRUD + deactivate + 2FA-reset + unlock; **assign the existing fixed 5 roles**, enforced server-side | **Per-tenant custom-role editor + finer 20 job-roles** (PR-T2, P1); global→per-tenant matrix | None blocking (server-side enforcement already ✅). RBAC v2 is **explicitly post-P0** |
| 6 | Attendance basic | M5 Attendance · ✅ ⚠ | Daily marking + period marking + list-by-date | Biometric depth; advanced analytics | **CRITICAL — fix cross-tenant overwrite** in `attendance.service.ts:13` `bulkMark`: validate `studentId ∈ tenant` + re-scope `attendance_records UNIQUE(student_id,date)` → include `institution_id` (§4.1 HIGH) |
| 7 | Fees basic | M6 Fees · ✅ | Structures, invoices, **manual/offline** payments, schedules, fines, discounts, receipts | **Real online payment gateway** (stub → optional PR-T-GW); refunds depth optional | `studentId` ownership check on `createInvoice`; re-scope `invoices.invoice_no` UNIQUE → per-tenant (§4.1) |
| 8 | Exams basic | M7 Exams · ✅ | Exam setup, marks entry, grade bands, report-cards/mark-sheets, GPA/CGPA (college) | **Question-bank** (🔭); advanced analytics | In-tenant student/subject check in `upsertResults` (§4.1 low echo leak) |
| 9 | Communication basic | M12 Communication · ✅ | In-app messaging + announcements + threads + generated alerts; email **if SMTP configured** | SMS/push providers (optional, degrade gracefully) | None blocking; smoke fan-out |
| 10 | Reports basic | M24 Reports · ✅ 🎨 | Core per-module reports + CSV/PDF; `reportcenter` | **IA consolidation** of 4 nav entries (polish, PR-T4); builder/scheduled/AI-insights depth | None blocking; **should** reason-gate + audit sensitive exports (§8) |
| 11 | Import/export basic | M28 Import/Export · 🟡 | Existing **students + teachers import**; per-module CSV/PDF export | **Unified tenant Import/Export center** (🟡→Phase 4, PR-T5) | Ensure imports validate + dry-run + row-level errors (rule 8) |
| 12 | Audit basic | M29 Audit/Activity · ✅ | Activity log, **own-tenant forced**, Mongo `audit_logs` with graceful degrade | Advanced audit analytics | None; **smoke the degraded (no-Mongo) path** |
| 13 | Tenant dashboard | M1 Dashboard/Overview · ✅ 🎨 | Existing stats + charts (staff-gated, scoped) | Exec **"needs-attention"** upgrade (P1, PR-T4) | **Honesty fix (trust) — remove/wire mock chrome**: hardcoded notification "5" / messages "3" badges, hardcoded "2026–2027" session pill, dead global search (§4.4 "do first") |

**Adjacent modules present but not P0-gated** (✅, ride PR-T0's isolation model,
verified by smoke — not part of the P0 must-have loop): Timetable (M8), Calendar
(M19), Documents/Certificates (M13), Transport (M14), Hostel (M15), Library (M16),
Inventory (M17), Discipline (M22). Transport/hostel/library/inventory already use
`UNIQUE(institution_id,…)`, so they need verification, not re-scoping.

---

## 3. The P0 correctness fixes, consolidated (all = PR-T0, master §4.1)

Nearly every "P0 fix" cell above is one PR. This is the heart of P0.

1. **Attendance cross-tenant write (HIGH).** `bulkMark` (`attendance.service.ts:13`)
   must validate `record.studentId` belongs to the tenant (copy the guard
   `periodattendance` already has), and `attendance_records`'s global
   `UNIQUE (student_id, date)` must become per-tenant so an `ON CONFLICT` can't cross
   tenants.
2. **Global UNIQUE namespaces → per-tenant** (additive migrations, never edit an
   applied one): `academic_years.name`, `classes.name`, `subjects.code`,
   `students.admission_no`, `teachers.employee_no`, `invoices.invoice_no` →
   `UNIQUE(institution_id, …)`. Copy the pattern already used in `0025_transport`,
   `0033_fee_management`, `0017_grade_bands`.
3. **Per-tenant sequences.** `student_admission_seq` / `teacher_employee_seq` move
   from single global sequences to per-tenant numbering.
4. **In-tenant FK validation** on `students(section_id)`, `exams.upsertResults`
   (student/subject), `fees.createInvoice(studentId)`, `academics.listClasses` —
   standardize on the `assertRef` pattern from the college modules / `promoteStudents`.
5. **Regression + new cross-tenant isolation tests** proving the two-tenant fixture
   holds (tenant A cannot read/overwrite tenant B; both can share names/numbers).

> Everything else in P0 is **already built** and needs **smoke verification**, not
> construction — except the one honesty fix (shell chrome, item 13).

---

## 4. P0 Definition of Done (checklist)

P0 is done when **all** of the following are true:

- [ ] **PR-T0 landed:** attendance cross-tenant write fixed; all six global UNIQUE
      namespaces + both sequences per-tenant via additive migrations; in-tenant FK
      validation on students / exams / fees / academics.
- [ ] **Isolation tests green:** a two-tenant fixture proves (a) tenant A cannot
      read or overwrite tenant B's rows via any P0 module, and (b) both tenants can
      simultaneously hold academic year "2025-2026", class "Grade 1", subject
      "MATH101", admission "ADM001", invoice "INV-0001", with independent numbering.
- [ ] **Full core loop, two real tenants (one school, one college), no collision:**
      academic-year → class/section *or* dept/program/batch/semester → admit a student
      (profile) → add a teacher → mark **daily + period** attendance → raise + collect a
      fee (offline) → enter exam marks → publish a report card → send an announcement →
      import a students CSV (dry-run + commit) → export a CSV → see the actions in the
      audit log → view the dashboard.
- [ ] **Server-side authz on every P0 endpoint:** `authenticate → requireTenant →
      requirePermission/authorize → owner-scope → service`; every inbound FK validated
      in-tenant (master §6).
- [ ] **Shell honesty:** no fabricated chrome shipped as live — the notification/
      message badges, session pill, and global search are wired to real data or removed
      (master §4.4).
- [ ] **Sensitive exports** (student PII, fees) reason-gated + audited (rules 5–6),
      or explicitly deferred with a tracked ticket.
- [ ] **No hard deletes** of core records — soft-delete/archive (students already
      soft-delete; verify the pattern holds for P0 writes).
- [ ] **Audit degrades gracefully** without Mongo (smoke the no-Mongo path).
- [ ] **Optional deps degrade gracefully** when unconfigured (SMTP/SMS/push, payment
      gateway) — never a hard failure (project rule).
- [ ] **Pre-push gate green:** backend `typecheck` + `test`, frontend `build`
      (CLAUDE.md hard rule). New endpoints carry `@openapi` blocks; new env vars go
      through `src/config/env.ts` + both `.env.example`.

**P0 exit → next:** with P0 done, the mainline continues at **PR-T1 (Settings)** per
`MODULE-SEQUENCE.md`.

---

## 5. Explicitly excluded from P0 (deferred, with where they land)

None of these block a trustworthy two-tenant core, so all are **post-P0**:

| Excluded from P0 | Master status | Lands in |
|---|---|---|
| PTM / parent meetings | M21 ⬜ Missing | Phase 5 / PR-T8 |
| Student-leave application | M23 🟡 (staff ✅) / 🔭 | Phase 5 / PR-T9 |
| Co-curricular | 🔭 Future | Future |
| Syllabus | 🔭 Future | Future |
| Substitute-teacher | 🔭 Future | Future |
| Question-bank | 🔭 Future | Future |
| **Real payment gateway** (vs the stub) | Integration stub (§4.5) | Optional PR-T-GW (off critical path) |
| **Live-classes provider** API | Join-link-only (§4.5) | Optional (off critical path) |
| **AI Copilot** | 🔭 Future | Phase 5 / PR-T11 |
| **Per-tenant custom-role editor** + finer 20 job-roles | M27 🟡 (RBAC v2) | Phase 1 / PR-T2 |
| Unified **Import/Export center** | M28 🟡 | Phase 4 / PR-T5 |
| Non-teaching **Staff master** | M9 🟡 | Phase 4 / PR-T6 |
| **Front-Office** unification | M18 🟡 | Phase 4 / PR-T7 |
| **Tenant Help/SOP** | M30 ⬜ | Phase 5 / PR-T10 |
| Reports **IA consolidation** | M24 ✅🎨 (polish) | Phase 2 / PR-T4 |
| Dashboard **"needs-attention"** upgrade | M1 ✅🎨 (polish) | Phase 2 / PR-T4 |

> **Distinction that keeps P0 honest:** the *existing fixed 5 roles* are **in** P0
> (users can be assigned admin/teacher/accountant/… with server-side enforcement).
> Only the **per-tenant custom-role editor and the finer job-roles** are excluded —
> they are RBAC v2 (PR-T2), not a prerequisite for a trustworthy core. Likewise,
> *fees collection* is **in** P0 (offline/manual), but the *real online gateway* is
> excluded (optional, degrading). Drawing the line here is what makes P0 both
> shippable and safe.
