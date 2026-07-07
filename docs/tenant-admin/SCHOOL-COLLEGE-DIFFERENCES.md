# School vs College — Handling, Shared Data Model & Where `institution_type` Drives the UI

> **Status: PLANNING ONLY.** No code, no migrations, no deployment is proposed by
> this document. It is an honest description of how GoCampusOS handles School vs
> College **today** (from a live read of the code) plus the recommended shape for
> finishing the job. Companion to `TENANT-ADMIN-MASTER-ROADMAP.md` (§4.3 is the
> canonical verdict; this doc is its detail). Where the older planning docs
> disagree with the live code, **the live code wins** and is cited by path.

**The one-line thesis (unchanged from the master roadmap):**
School vs College is **configuration of one product, not a fork.** There is no
separate "college build". The same tables, the same routers, the same pages, and
the same design system serve both editions; a small set of switches (an
institution `type`, a mode store, a terminology engine, one route guard, and a
handful of additive nullable columns) change what those shared surfaces *say* and
*allow*. **The completion work is to finish adopting that pattern — never to
duplicate the product.**

---

## 1. How the split works today (authoritative live facts)

Four mechanisms, in the order a request meets them:

| # | Mechanism | Where (live code) | What it does | Source of truth? |
|---|-----------|-------------------|--------------|------------------|
| 1 | **`institutions.type`** = `'school' \| 'college'` | DB column; set by seed to `'school'` (`backend/src/db/seed.ts:45`), switched by `PATCH /college/settings` | The **canonical** edition flag. Everything else should reconcile to it. | ✅ **Yes — DB is the truth.** |
| 2 | **`mode` store** (`school \| college`) | `frontend/src/stores/mode-store.ts` (`sreedo-mode`, zustand + `persist`, defaults `"school"`) | Pre-login presentation context chosen on `/select`; drives sidebar, theming, copy **before** `/auth/me` returns. | ⚠️ Client cache; can be briefly stale. |
| 3 | **Reconciliation** from `/auth/me.institutionType` | `frontend/src/app/(dashboard)/layout.tsx:456-465` — `if (me.institutionType) setMode(me.institutionType)` | On dashboard load, forces the client `mode` to match the DB `type`. Makes #1 win over #2. | Bridge (DB → store). |
| 4 | **`requireInstitutionType('school'\|'college')`** | `backend/src/middleware/institution-type.ts` — 60 s TTL cache, `super_admin` bypass, explicit cache-bust on switch | The backend half: college structure routes are college-only; class/section creation is school-only. Frontend hiding is *not* the enforcement. | Enforcement gate. |
| 5 | **`useTerms()` terminology engine** | `frontend/src/lib/terms.ts` (+ `getTerms(mode)` for non-React) | Maps the domain nouns that differ between editions so one page reads naturally in both. | Presentation. |

### The terminology engine, exactly as coded (`terms.ts`)

| Concept (key) | School | College |
|---------------|--------|---------|
| `teacher` / `teachers` | Teacher / Teachers | Faculty member / **Faculty** |
| `klass` / `klassPlural` | Class / Classes | **Program** / Programs |
| `section` / `sectionPlural` | Section / Sections | **Batch** / Batches |
| `subject` / `subjectPlural` | Subject / Subjects | **Course** / Courses |
| `term` | Term | **Semester** |
| `admissionNo` | Admission No | **Registration No** |
| `reportCard` | Report Card | **Grade Sheet** |
| `classTeacher` | Class Teacher | **Faculty Advisor** |
| `student` / `students` | Student / Students | Student / Students *(same)* |

### The nav is **derived**, not duplicated (`layout.tsx:96-111`)

The college sidebar is not a hand-written second array — it is computed from the
school array:

```
COLLEGE_NAV = SCHOOL_NAV
  .flatMap(item => item.href === "/classes" ? COLLEGE_ACADEMICS : [item])  // swap 1 item → 7
  .map(item => item.href === "/teachers" ? { ...item, label: "Faculty" } : item)  // relabel
```

So college mode **replaces the single `/classes` item** with a 7-item college
academic block — **College Home, Departments, Programs, Semesters, Subjects,
Enrollments, Results** (`/college/*`) — and **relabels Teachers → Faculty**.
**Everything else (operations, finance, communication, admin — ~50 items) is
byte-for-byte shared.** That is the whole point: the two editions differ by ~8
nav rows out of ~57.

### The college data model exists and is born multi-tenant (migration `0023_college_mode.sql`)

- **New tenant-scoped tables**, every one `institution_id`-scoped with
  `UNIQUE(institution_id, …)`: `departments`, `programs`, `batches`,
  `semesters`, `program_subjects` (subject↔program/semester **with `credits`**),
  `enrollments` (student→program/semester/batch), `staff_allocations`
  (teacher→dept/program/subject, the HOD/allocation substrate).
- **Additive, school-safe (all nullable) columns on existing tables** — this is
  the shared-model pattern in action: `exams.semester_id`,
  `fee_structures.program_id` + `semester_id`, `grade_bands.grade_point`
  (GPA/CGPA), `timetable_entries.semester_id` (+ `section_id` made nullable with
  a `section_id IS NOT NULL OR semester_id IS NOT NULL` check).
- **Permissions** added the same way as every other module (`college:*`,
  `departments:*`, `programs:*`, `semesters:*`) and granted to `admin`
  (full) / `teacher` + `accountant` (read).

---

## 2. The honest gaps (why college mode is not yet first-class)

Consistent with master-roadmap §4.3. These are real and code-verified:

1. **Terminology engine adopted in only ~20 of ~120 pages.** A live grep for
   `useTerms`/`@/lib/terms` returns ~20 dashboard pages (students, exams,
   attendance, homework, teachers, communication, timetable, reports, a few
   more). **The other ~100 pages render hard-coded "Class / Section / Subject /
   Teacher".** So a college admin browsing most of the app still sees school
   nouns, and a few pages carry literal `"school"` copy (analytics, dashboard,
   branding). College mode therefore *reuses the school pages* — correct
   architecture, incomplete adoption.
2. **Homework is school-only.** `homework.schema.ts:4` requires
   `sectionId: z.string().uuid()` (NOT NULL, and `updateHomeworkSchema` omits it);
   the table's `section_id` is `NOT NULL`. There is **no semester/program
   variant**, unlike exams/fees/timetable which already got their additive
   college column. A college has no sections → homework cannot be created in
   college mode.
3. **Three representations of the mode flag** (§1 rows 1-3): the persisted client
   store (`sreedo-mode`), the `/auth/me.institutionType` field, and the
   `/college/settings` toggle. They *do* reconcile (DB wins on load), but the
   persisted store can flash stale school chrome for one render before `/auth/me`
   resolves, and there is no single helper that "reads the effective mode". This
   is a consolidation task, not a correctness bug.

None of these require forking the product. All three are "finish the pattern"
tasks.

---

## 3. Common modules (shared — identical code, both editions)

These modules carry **no** school/college structural difference; they are
`institution_id`-scoped and behave the same in both editions. Any difference is
cosmetic (a label via `useTerms`) — never separate code:

- **People & access:** Student Management, Teacher/Faculty Management, Tenant User
  Management, Tenant RBAC, Parent/Student portal readiness.
- **Daily ops:** Communication & Announcements, Calendar/Events, Documents &
  Certificates (receipts / ID cards / TC), Front Office (visitors / enquiry /
  complaints / lost-found).
- **Money:** Fees & Collections, Online Payments, Fee Refunds, Accounting,
  Payroll — shared; college simply *targets* fee structures by program/semester
  (additive columns), it does not use a different fees engine.
- **Facilities & inventory:** Transport, Hostel, Library, Inventory, Cafeteria.
- **Engagement & welfare:** Discipline/Behaviour, Infirmary, Alumni, Polls,
  Quizzes, Gallery, Study Materials, Live Classes.
- **Admin & insight:** Reports/Analytics, Report Builder, Scheduled Reports, AI
  Insights, Audit/Activity Log, Branding, Integrations, Jobs, Security, Biometric.
- **Admissions:** shared pipeline (enquiry → application → convert-to-student);
  the placement step differs (section vs enrollment) but the funnel is one module.

**Only the academic-structure spine, and the outputs computed from it (exams
targeting, attendance granularity, results/GPA, homework targeting), is
edition-specific.** That is a small blast radius — keep it that way.

---

## 4. School-specific settings

Available when `institutions.type = 'school'`; creation of these is gated
school-only by `requireInstitutionType('school')` (e.g. class/section creation):

| Setting | Backing (live) | Notes |
|---------|----------------|-------|
| **Classes → Sections** | `academics` (`classes`, `sections`) | The school academic spine; nav item `/classes`. |
| **Roll number** | student roll within a section | Section-relative ordering. |
| **Class Teacher** | section→teacher assignment | `useTerms().classTeacher` = "Class Teacher". |
| **Period timetable** | `timetable_entries.section_id` | Section-targeted; day×period grid, clash-checked. |
| **Term exams** | `exams` (no `semester_id`) + `grade_bands` (letter grades) | Term/unit/annual exam types; report cards. |
| **Fee terms** | `fee_structures` by class, term schedules | Term-wise fee schedules & fines. |
| **Term** as the academic period | `useTerms().term` = "Term" | vs Semester in college. |
| **Admission No** | `students.admission_no` | `useTerms().admissionNo` = "Admission No". |

## 5. College-specific settings

Available when `institutions.type = 'college'`; creation gated by
`requireInstitutionType('college')` on the `/college/*` structure routes
(`college.routes.ts:82`). `/college/overview` + `/college/settings` stay open so a
school can read its mode and switch in.

| Setting | Backing (live, 0023) | Status |
|---------|----------------------|:------:|
| **Departments** | `departments` (code unique per tenant, optional `head_teacher_id`) | ✅ |
| **Programs / courses** | `programs` (dept-scoped, `duration_semesters`) | ✅ |
| **Batches** | `batches` (program-scoped, `start_year`) | ✅ (API; no top-level nav page) |
| **Semesters** | `semesters` (program-scoped, `number`, optional `academic_year_id`, dates) | ✅ |
| **Subjects / papers + credits** | `program_subjects` (subject↔program/semester, `credits NUMERIC`) | ✅ |
| **HOD / staff-allocation workflow** | `staff_allocations` (teacher→dept/program/subject); `departments.head_teacher_id` | 🟡 substrate exists; no dedicated HOD-approval workflow UI |
| **Internal / external exams** | `exams.semester_id` (additive) | 🟡 column exists; exam-*type* internal/external split not modelled distinctly |
| **Subject / hour attendance** | `periodattendance` (period/subject granularity) | ✅ already the right primitive for college hour attendance |
| **Academic calendar** | `semesters.start_date/end_date` + shared `calendar` | ✅ (dates on semesters) |
| **University-exam support** | — | 🔭 **Future** (external university exam registration/hall-tickets/results import not built) |
| **Semester** as the academic period | `useTerms().term` = "Semester" | ✅ |
| **Registration No** | `students.admission_no` relabelled | `useTerms().admissionNo` = "Registration No" |
| **Results → GPA/CGPA** | `grade_bands.grade_point` + `/college/students/:id/{semesters/:id/result,cgpa}` | ✅ owner-scoped GPA/CGPA |

---

## 6. Shared-data-model recommendation — **DON'T fork the product**

The pattern is already established by migration 0023 and by exams/fees/timetable.
Standardize on it for every remaining edition difference:

> **One table + additive nullable college columns + an `institution_type` gate.**

Concretely, for any entity that differs by edition:

1. **Keep one table.** Do not create `school_homework` / `college_homework`. Add
   the college dimension as **nullable** columns beside the school ones
   (`section_id` *or* `semester_id`/`program_id`), exactly as
   `timetable_entries` already does.
2. **Enforce "one of" at the DB.** A `CHECK (section_id IS NOT NULL OR
   semester_id IS NOT NULL)` constraint (the timetable precedent) keeps rows
   valid in both editions without a type column on the row.
3. **Gate creation by type, not the whole module.** Use
   `requireInstitutionType()` on the *create* path so a school can't author a
   semester-targeted record and vice-versa — but keep reads/shared logic common.
4. **Validate the inbound FK belongs to the tenant** (`assertRef` pattern from
   the college service) before insert/echo — this is the same isolation rule the
   master roadmap's §4.1 hardening applies everywhere.
5. **Relabel via `useTerms()`, never via a second component.** The page is one
   component; only its strings are mode-aware.

**Applied to the known gap — Homework (the concrete P1):** add nullable
`semester_id` (and/or `program_id`) to `homework`, drop the `NOT NULL` on
`section_id`, add the "one of" check, make `sectionId` optional in the schema
(require exactly one target), and gate the create path. **~1 additive migration +
schema/service tweak + `useTerms()` on the page — not a new module.** This mirrors
exactly how timetable already gained its college target.

**Anti-patterns to reject:** a `type` column driving `if (school) … else …`
branches through service code; parallel routers per edition; duplicated pages;
copying the fees/exams engines. None of these exist today — keep it that way.

---

## 7. Where `institution_type` should drive the UI / options

The single lever (`mode`, reconciled from `institutions.type`) should change
these surfaces — most already have the primitive; the work is *adoption*:

| Surface | What changes school → college | Mechanism (exists?) | Status |
|---------|-------------------------------|---------------------|:------:|
| **Labels / copy** | Teacher→Faculty, Class→Program, Section→Batch, Subject→Course, Term→Semester, Admission→Registration, Report Card→Grade Sheet | `useTerms()` / `getTerms()` | 🟡 ~20/120 pages |
| **Navigation** | `/classes` → 7-item college academics block; "Teachers"→"Faculty" | `COLLEGE_NAV` derive (`layout.tsx`) | ✅ |
| **Academic setup forms** | Class/Section/Roll fields → Department/Program/Semester/Batch/Credits fields | `academics` vs `college` pages + `requireInstitutionType` | ✅ (separate pages) |
| **Student placement** | Placed in a **section** → placed via an **enrollment** (program/semester/batch) | `students.section_id` vs `enrollments` | ✅ |
| **Form fields on shared pages** | Section pickers → Semester/Program pickers (attendance, exams, fees, homework, timetable) | additive columns; picker swap by mode | 🟡 partial (timetable/exams/fees done; homework not) |
| **Exam types** | Term/unit/annual → internal/external + `semester_id` | `exams.semester_id` | 🟡 column done, type split pending |
| **Attendance granularity** | Daily (section) → **hour/subject** (period) as the college default | `periodattendance` already exists | ✅ primitive; default-surface by mode pending |
| **Results / grading** | Letter-grade report card → **GPA/CGPA** grade sheet | `grade_bands.grade_point` + `/college/.../result`,`/cgpa` | ✅ |
| **Homework target** | Section → Semester/Program | *(needs additive column)* | ⬜ **build (P1)** |
| **Dashboard / analytics copy** | "school" nouns/KPIs → college equivalents | hard-coded strings today | 🟡 pending |

---

## 8. College-parity checklist (finish these → college mode is first-class)

Ordered, and consistent with the master roadmap's PR-T3 ("School/College
Terminology + Homework college variant, P1"):

- [ ] **Adopt `useTerms()` across the remaining ~100 pages.** Swap hard-coded
      Class/Section/Subject/Teacher/Term/Admission literals for the term set.
      Mechanical, low-risk, high-visibility. Include the literal-`"school"` copy
      in analytics / dashboard / branding.
- [ ] **Homework college variant** — additive nullable `semester_id`/`program_id`
      + "one of" check + optional `sectionId` in the schema + create-path
      `requireInstitutionType`/target validation. One migration + one page's
      picker. (§6.)
- [ ] **Surface hour/subject attendance as the college default** — `period_attendance`
      already provides the primitive; make it the mode-default attendance entry
      point for college, keep daily for school.
- [ ] **Consolidate the three mode representations to one** effective-mode helper;
      eliminate the stale-chrome flash by resolving mode before first paint.
- [ ] **Exam internal/external type split** for college (`exams.semester_id`
      exists; add the type distinction) — P2.
- [ ] **HOD / staff-allocation workflow UI** on top of `staff_allocations` +
      `departments.head_teacher_id` — P2.
- [ ] **University-exam support** (external exam registration, hall tickets,
      university result import) — 🔭 **Future**, explicitly out of P0/P1.

**Non-goals (keep rejecting):** a separate college codebase, parallel routers or
pages per edition, a per-row `type` branch through shared services. School vs
College stays **configuration, not a fork.**

---

*Cross-references: `TENANT-ADMIN-MASTER-ROADMAP.md` §4.3 (verdict),
`TENANT-ADMIN-DATA-MODEL.md` (entity isolation & re-scoping), `MODULE-SEQUENCE.md`
(PR-T3 placement), `TENANT-ADMIN-SMOKE-TEST-PLAN.md` (the "School vs College"
checklist that exercises this).*
