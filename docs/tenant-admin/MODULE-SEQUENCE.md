# Tenant Admin — Recommended Module Sequence (Build Order)

> **Status: PLANNING ONLY.** No code, no migrations, no deployment. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` (canonical). This document only **orders** the
> work that the master roadmap already scoped and verdicted; it does not re-verdict
> any module. Where the master doc and this doc could appear to disagree, the
> master doc wins and this is the bug.

---

## 0. Why order matters *given the ~90%-built reality*

The master roadmap's live inventory found the tenant ERP is **not a greenfield
build**: **23 of 30 modules Completed, 5 Partial, 2 Missing** (§3), ~120 working
frontend pages and 56 backend routers with real business logic. A conventional
"build core → build ops → build money → build extended → build engagement" order
assumes empty modules. Here the modules mostly **exist**, so sequencing by "what
to build" is the wrong axis. The right axis is:

> **harden → complete-partials → build-missing → wrap-up layer.**

Three consequences drive the order below:

1. **Correctness precedes features.** There is a live, exploitable **cross-tenant
   attendance write** and a set of **global UNIQUE/sequence namespaces** that make
   true multi-tenancy incorrect (master §4.1). No completion or feature work should
   land on top of an isolation model that is known-broken, because every later
   module inherits the in-tenant-FK-validation pattern. Hence **Phase 0 leads.**
2. **Foundation partials unblock the rest.** Unified **Settings** is the home every
   module deep-links to; **RBAC v2** decides who can touch each module. These are
   Partial (🟡) and gate the polish/build work, so they come early (Phase 1).
3. **Build only what's Missing; smoke everything Completed.** For the 23 ✅ modules
   the work is *verification* (never end-to-end tested this cycle) + *polish*, not
   construction. Only PTM (⬜), Student-Leave (⬜ new), and Tenant Help/SOP (⬜) are
   genuine builds, and they come last (Phase 5) because nothing depends on them.

Priorities (P0/P1/P2/🔭) below are quoted verbatim from master §5; verdicts
(✅/🟡/⬜/🎨) from master §3. This doc never upgrades a verdict.

---

## Phase 0 — Isolation & Correctness Hardening  → **PR-T0**

Fix the tenant-isolation defects before anything else. Scope = master §4.1 exactly.

- Fix the **HIGH cross-tenant attendance overwrite**: `attendance.service.ts:13`
  `bulkMark` inserts with the caller's `institution_id` but never checks that
  `record.studentId` belongs to the tenant, and `attendance_records` has a **global**
  `UNIQUE (student_id, date)`, so its `ON CONFLICT (student_id,date) DO UPDATE` lets
  tenant A overwrite tenant B's row. Copy the in-tenant guard `periodattendance`
  already uses; re-scope the constraint to include `institution_id`.
- **Re-scope global UNIQUE namespaces** (additive migrations, never edit applied
  ones): `academic_years.name` (`0011_tenancy.sql:46`), `classes.name`,
  `subjects.code`, `students.admission_no`, `teachers.employee_no`,
  `invoices.invoice_no` (`0004_fees.sql:16`) → `UNIQUE(institution_id, …)`; move
  `student_admission_seq` / `teacher_employee_seq` from single global sequences to
  **per-tenant** numbering. Newer tables already model this correctly
  (`0025_transport`, `0033_fee_management`, `0017_grade_bands`) — copy that pattern.
- **Add in-tenant FK validation** on the inconsistent read/echo paths: `students`
  (`section_id`), `exams` (`upsertResults` student/subject), `fees` (`createInvoice`
  `studentId`), `academics` (`listClasses` count). Standardize on the `assertRef`
  pattern from the college modules / `promoteStudents`.

**1) Why this order.** It is the only item with an exploitable cross-tenant write;
it unblocks true multi-tenant operation (two tenants cannot today share a year,
class, subject, admission, or invoice number); and it establishes the
in-tenant-FK-validation pattern **every** subsequent module reuses. Small,
high-certainty, fully testable — the "correctness before features" posture the
Super Admin suite followed (master §9).

**2) Dependencies.** None upstream — this is the root. Everything downstream depends
on it: the re-scoped constraints and the `assertRef` convention are prerequisites
for trusting any later create/import/echo path.

**3) Risks.** Additive migrations must backfill safely (existing rows may already
collide on the soon-to-be-relaxed global unique — verify no *cross-tenant* dup
exists before switching a global unique to per-tenant, and no *in-tenant* dup is
introduced). Sequence migration must not reset live numbering visible to users.
Attendance fix must not break the legitimate same-student re-mark (upsert within
one tenant must still work). All changes are backend + migration only — no feature
surface changes, keeping blast radius minimal.

**4) Smoke-test requirement.** A **two-tenant fixture** (tenant A, tenant B) is the
gate: (a) A's `bulkMark` with B's student UUID is rejected / cannot mutate B's row;
(b) both tenants can simultaneously hold academic year "2025-2026", class "Grade 1",
subject "MATH101", admission "ADM001", invoice "INV-0001"; (c) admission/employee
numbering is independent per tenant; (d) a foreign UUID passed to
students/exams/fees/academics is rejected, not echoed. New cross-tenant isolation
regression tests must accompany the fix (master §9 next-PR prompt).

**5) Completion criteria.** Attendance cross-tenant write closed; all six global
UNIQUE namespaces + both sequences per-tenant via additive migrations; in-tenant FK
validation on the four cited services; new isolation tests green; backend
`typecheck` + `test` pass. **No new feature surface.** PR opened, no deploy, await
approval (master rules).

---

## Phase 1 — Foundation completion  → **PR-T1, PR-T2** (+ Academic Setup polish)

Complete the Partial foundation modules that everything else links to.

- **Tenant Settings (unified)** — Module 25 🟡 → **PR-T1**. Build the single tenant
  Settings home (institution profile read, academic-year CRUD, branding, module
  toggles, mode, notification prefs) and **reconcile the three mode-switch sources
  of truth** (`/auth/me.institutionType`, `/college/settings` toggle, pre-login
  store) to one (master §4.3, §5 wrap-up).
- **Tenant RBAC v2** — Module 27 🟡 → **PR-T2**. Add `role_permissions.institution_id`
  (per-tenant matrix), a **tenant-facing role manager**, and the finer job-roles
  (Principal, Admission Officer, Exam Controller, HOD, Librarian, Transport Manager,
  Hostel Warden, Front Office, Read-only Auditor, …) delivered as **permission-sets**
  — *not* by exploding the `user_role` enum, exactly as Super Admin delivered
  platform sub-roles via `users.platform_role` (master §4.2). Full model in
  `TENANT-ADMIN-RBAC-PLAN.md`.
- **Academic Setup polish** — Module 2 ✅. The global-unique re-scope already landed
  in PR-T0; here, lightly surface `class_subjects` (thinly surfaced today). Small;
  folds into the PR-T1 vicinity.

**1) Why this order.** Settings is the deep-link target for nearly every other
module (branding, academic-year, toggles), so it should exist before the polish and
build phases reference it. RBAC v2 decides *who* may operate each module; landing it
before the daily-ops/money polish means later work can adopt granular
`requirePermission("module:action")` (master §6.10) against real per-tenant roles
instead of the fixed 5-role enum.

**2) Dependencies.** Depends on **PR-T0** (per-tenant scoping is the substrate for a
per-tenant `role_permissions` and a per-tenant Settings profile). RBAC v2 (PR-T2)
should follow Settings (PR-T1) since the role manager lives inside Settings IA.

**3) Risks.** RBAC v2 is the highest-design-risk item in the roadmap: migrating a
**single global** `role_permissions` matrix to per-tenant must default every existing
tenant to today's effective grants (no silent privilege change) and must keep
`super_admin` bypass intact. Settings must **read** the platform-owned institution
profile without letting a tenant edit platform-owned fields. Mode-switch reconciliation
must not strand a college mid-switch (cache-bust semantics, master §"project state").

**4) Smoke-test requirement.** Settings: change branding + academic-year + a module
toggle and confirm the dependent surface reflects it; switch mode and confirm
college/school routing + terminology flip. RBAC v2: create a custom per-tenant role
(e.g. "Exam Controller"), assign a user, confirm they can reach exams but are 403'd
elsewhere, and confirm tenant B's roles are invisible to tenant A.

**5) Completion criteria.** Unified Settings page live and is the canonical
academic-year/branding/toggle/mode home; one mode source of truth; per-tenant
`role_permissions` with a working tenant role manager and ≥ the brief's job-roles as
permission-sets; existing tenants unchanged in effective permissions; smoke passes;
pre-push gate green.

---

## Phase 2 — School/College Unification + Daily-Ops Polish  → **PR-T3, PR-T4**

Make the dual-mode promise real and make the shell honest.

- **Terminology adoption** — master §4.3 → **PR-T3**. `useTerms()` is adopted in only
  ~20 of ~120 pages; college mode still renders "Class/Section" and literal "school"
  copy in spots (`analytics`, `dashboard`, `branding`). Adopt the terminology engine
  across the academic pages.
- **Homework college variant** — Module 20 ✅🟡 → **PR-T3**. `homework` is school-only
  (`section_id NOT NULL`); add the additive college/semester variant the other
  academic modules already received.
- **Dashboard/Overview upgrade + shell-honesty fixes + IA consolidation** — Modules 1
  ✅🎨 & 24 ✅🎨 → **PR-T4**. Upgrade to an exec "needs-attention" overview; **remove or
  wire the mock chrome** (hardcoded notification "5" / messages "3" badges, hardcoded
  "2026–2027" session pill, dead global search — master §4.4 "do first, it's a trust
  issue"); group the flat **57-item** sidebar into Academics / Operations / Finance /
  Communication / Admin; **consolidate the four overlapping "Reports" nav entries into
  one hub** (master §4.4, §7, §8).
- **Daily-ops smoke** — Modules 5/8/12/19 (attendance, timetable, communication,
  calendar), all ✅ (attendance now post-T0). Never end-to-end verified this cycle.

**1) Why this order.** Unification and shell-honesty are user-trust items that touch
*every* page, so they should land before the extended-ops and engagement work adds
more pages that would otherwise inherit the same inconsistencies. Shell honesty
specifically is called "do first" in master §4.4. It follows Phase 1 because the
grouped nav and dashboard are role-/module-aware and want RBAC v2 + Settings toggles.

**2) Dependencies.** PR-T4's role-/module-aware nav depends on **RBAC v2 (PR-T2)** and
Settings **module toggles (PR-T1)**. Homework college variant depends on the mode
source-of-truth reconciliation (PR-T1) and mirrors the additive-column pattern
proven by PR-T0's re-scoping work.

**3) Risks.** Terminology adoption is broad (~100 pages) and easy to do
inconsistently — do it via the `useTerms()` facade, not literal swaps, to avoid
regressions. Dashboard "needs-attention" must stay scoped/staff-gated (do not leak
cross-tenant aggregates). Removing mock chrome must not remove a real feature users
now rely on — wire where a real signal exists, remove where it does not.

**4) Smoke-test requirement.** Log in as a college tenant and confirm nouns flip
(Teacher→Faculty, Class→Program, Section→Batch, Subject→Course, Term→Semester,
Admission No→Registration No) with no "school" literals on academic pages; create +
submit + grade a **college** homework by semester/batch; confirm no shell element
shows fabricated data; run the attendance/timetable/communication/calendar happy
paths under the two-tenant fixture.

**5) Completion criteria.** `useTerms()` adopted across academic pages; homework has a
working college/semester variant; sidebar grouped; one Reports hub; zero mock chrome
presented as live; dashboard shows a real needs-attention overview; daily-ops smoke
checklists pass; pre-push gate green.

---

## Phase 3 — Money & Academic-Output Hardening  → (correctness in **PR-T0**) + optional **PR-T-GW**

> **Key reality note.** In a greenfield plan this phase would *build* fees and exams.
> Here they are **already ✅** (deep fees: structures/invoices/payments/schedules/
> fines/discounts + refunds + online; exams + report-cards/mark-sheets + GPA/CGPA).
> Their **correctness** slice — `fees.createInvoice` `studentId` ownership check,
> `exams.upsertResults` in-tenant student/subject check, and `invoices.invoice_no`
> re-scope — is **pulled forward into PR-T0** because a trustworthy multi-tenant core
> cannot ship without it. So this phase is a **verification + consolidation +
> optional-integration** checkpoint, not a build.

- **Fees** — Module 6 ✅. Ownership check + invoice-no re-scope: **done in PR-T0**.
  Real payment gateway is a **stub** (`onlinepayments/gateway.ts:104-115` simulates
  the provider) → **optional PR-T-GW**: wire Razorpay/Stripe/PayU behind the existing
  order→checkout→webhook flow, **degrading gracefully when unconfigured** (master
  §4.5; project rule). Off the critical path — may land any time after PR-T0.
- **Exams** — Module 7 ✅. In-tenant student/subject check: **done in PR-T0**. Here:
  smoke marks-entry → grade bands → report card / mark sheet → GPA/CGPA (college).
- **Documents / Certificates** — Module 13 ✅. Smoke receipts / ID cards / certs /
  **dues-gated TC**.
- **Reports IA consolidation** — Module 24 ✅🎨. Delivered by **PR-T4** (§4.4 IA theme);
  **validated** here (one Reports hub; every core module exposes a filtered report +
  CSV/PDF; sensitive exports reason-gated + audited — master §8).

**1) Why this order.** Money and grades are the highest-consequence data, so they are
hardened **earliest** (in PR-T0), then **verified** here once the foundation + IA are
stable. Running verification after Phase 1–2 means reports/exports are consolidated
and RBAC-gated before we assert the money surface is safe.

**2) Dependencies.** Correctness depends on **PR-T0**; reason-gated exports depend on
**RBAC v2 (PR-T2)** and the Reports hub in **PR-T4**. The optional gateway depends only
on PR-T0 and is independent of the mainline.

**3) Risks.** The optional gateway touches real money — must be idempotent on webhook
(follow the existing SaaS payment-gateway idempotency ledger pattern) and never
expose gateway secrets (master §6.9). Export reason-gating must not block legitimate
day-to-day CSV pulls (scope the gate to PII/fees/payroll/disciplinary).

**4) Smoke-test requirement.** Under the two-tenant fixture: raise + collect a fee
(offline) and confirm the ledger/receipt; enter exam marks and publish a report card;
pull a fees report and a student-PII report and confirm the sensitive one is
reason-gated + audited; if the gateway is wired, run order→checkout→webhook in test
mode and confirm graceful degrade when unconfigured.

**5) Completion criteria.** Fees + exams verified tenant-safe end-to-end (PR-T0 fixes
confirmed in situ); documents/TC smoke passes; single Reports hub with core reports +
CSV/PDF and reason-gated+audited sensitive exports; gateway either wired-and-optional
or explicitly deferred with a ticket. No re-write of the completed fees/exams logic.

---

## Phase 4 — Extended-Ops Completion  → **PR-T5, PR-T6, PR-T7** (+ smoke)

Finish the Partial operations modules; smoke the Completed ones.

- **Import/Export center** — Module 28 🟡 → **PR-T5**. Today import = `students` +
  `teachers` only; export = per-module CSV/PDF; the Data Export Center is Super-Admin.
  Build a **unified tenant Import/Export** with dry-run preview + row-level errors
  (master rule 8), reason-gated + audited sensitive exports.
- **Staff master (non-teaching)** — Module 9 🟡 → **PR-T6**. `teachers` is overloaded;
  add a **non-teaching staff master**. (Recruitment/appraisal/onboarding stay 🔭.)
- **Front-Office unification** — Module 18 🟡 → **PR-T7**. Unify the separate
  `visitors` / enquiry / complaints / `lostfound` surfaces into one front-office hub;
  add postal-dispatch / call register.
- **Extended-ops smoke** — Modules 4/14/15/16/17 (admissions, transport, hostel,
  library, inventory), all ✅. Note transport/hostel/library/inventory already use
  `UNIQUE(institution_id, …)` — they ride PR-T0's model and need verification, not
  re-scoping.

**1) Why this order.** These are lower-priority (master §5: Front Office P2; Import/
Export & Staff master P1) and none blocks the foundation or money surface, so they
follow the trust/consolidation phases. They precede Phase 5 because the Import/Export
center and Staff master are *completions of existing partials* (lower risk) whereas
Phase 5 is *net-new construction* (higher risk).

**2) Dependencies.** Import/Export center depends on **RBAC v2 (PR-T2)** (reason-gate +
audit) and the shared drawer/dry-run UX pattern (master §7.6). Staff master and
Front-Office unification depend on PR-T0 isolation + Settings module toggles.

**3) Risks.** Import/Export is the highest-risk data path — a bad import can corrupt a
tenant; enforce validate + dry-run + row-level errors + no partial commit. Staff
master must not fork the `teachers` model in a way that breaks payroll/staff-leave
already wired to it. Front-office unification is mostly IA — risk is regressing the
existing visitor/complaint/lost-found flows during the merge.

**4) Smoke-test requirement.** Import a CSV with deliberate bad rows and confirm the
dry-run blocks commit and reports per-row errors; export a sensitive dataset and
confirm reason-gate + audit entry; create a non-teaching staff record and confirm it
does not appear as a teacher; log a visitor + a complaint + a lost-found item through
the unified front office; smoke transport/hostel/library/inventory happy paths.

**5) Completion criteria.** Unified Import/Export center covers ≥ the core entities
with dry-run + audit; non-teaching Staff master live and distinct from teachers;
single front-office surface with postal/call register; extended-ops smoke checklists
pass; pre-push gate green.

---

## Phase 5 — Engagement & New Modules  → **PR-T8, PR-T9, PR-T10, PR-T11**

Build the genuinely-missing modules and close the wrap-up layer (mirrors Super Admin
closing with Overview E + Help Q).

- **PTM / Parent Meetings** — Module 21 ⬜ → **PR-T8**. **Build**: scheduling, slot
  booking, invites, attendance, notes; school + college.
- **Student Leave Management** — Module 23 ✅🟡 (staff leave ✅) → **PR-T9**. **Build**
  the student leave-application → approval → attendance-integration flow.
- **Discipline smoke** — Module 22 ✅. Verify register + status machine + audit + portal
  flag end-to-end.
- **Homework (college)** — Module 20. The additive college/semester **variant ships in
  PR-T3 (Phase 2)**; here, engagement-side smoke: college submissions → grading.
- **Tenant Help/SOP** — Module 30 ⬜ → **PR-T10**. **Build** a tenant-facing Help/SOP
  surface (the `help` module is platform-only today — `help:read` is never granted to
  tenant roles → 403). Reuse the Super-Admin Q curated-docs pattern, tenant-scoped
  perms.
- **AI Copilot Phase 1** — 🔭 → **PR-T11**. Read-only assistant; see
  `AI-COPILOT-PHASE1-PLAN.md`.

**1) Why this order.** These are last because **nothing depends on them** and they are
the roadmap's only true net-new builds (higher uncertainty). Help/SOP and AI Copilot
are the wrap-up layer — most valuable once the surface they document/assist is stable
and consolidated.

**2) Dependencies.** All depend on **PR-T0** (isolation) and **PR-T2** (roles: PTM
organizer, leave approver, help author). PTM/Student-Leave lean on Communication
(Module 12) for invites/notifications and Attendance (Module 5) for leave→attendance
integration. AI Copilot depends on the consolidated Reports/data surface being stable.

**3) Risks.** New modules must follow the routes/schema/service + zod + `ApiError`
convention and be `institution_id`-scoped with in-tenant FK validation from day one
(do not reintroduce the Phase-0 class of bug). Student-leave must integrate with
attendance without racing the daily/period mark. AI Copilot must be **read-only** and
strictly tenant-scoped (no cross-tenant retrieval) and degrade gracefully without
OpenAI (project rule).

**4) Smoke-test requirement.** Schedule a PTM with slots, invite, record attendance +
notes; file a student leave, approve it, confirm attendance reflects it; open the
tenant Help surface as a non-admin role and confirm access (no 403) with tenant-scoped
content; ask the Copilot a question and confirm answers never cross tenant boundaries
and it degrades when unconfigured.

**5) Completion criteria.** PTM, Student-Leave, and Tenant Help/SOP live and
tenant-isolated; discipline + college-homework smoke pass; AI Copilot Phase-1 read-only
assistant shipped per its plan or explicitly deferred; pre-push gate green. The
🔭 Future items (co-curricular, syllabus, substitute-teacher, question-bank) remain
out of scope (master §3 tally).

---

## Mapping the earlier brief's 5-phase order onto this reality

The earlier planning brief proposed a **conventional greenfield 5-phase build**
(paraphrased). Because the master inventory found the ERP ~90% built, each greenfield
"build X" phase collapses to "harden/complete/smoke X" — and we **insert a Phase 0**
the greenfield plan never needed. The verb changes; the domain grouping mostly
survives.

| Brief's phase (greenfield "build") | Master-doc reality | Our phase(s) | What differs |
|---|---|---|---|
| *(none)* | Live cross-tenant write + global-unique/sequence bugs (§4.1) | **Phase 0** | **Inserted.** A greenfield build assumes clean isolation from day one; a retrofit on a live ~90%-built system must **lead with correctness**. |
| **P1 — build core academic foundation** (year, class/section *or* dept/program/batch/sem, students, staff, admin users/roles) | Academic Setup ✅, Students ✅, Teachers ✅, Users ✅; Settings 🟡, RBAC 🟡 | **Phase 0** (isolation) + **Phase 1** (Settings, RBAC v2, Academic polish) | **Largely DONE — so our Phase 1 is completion + hardening, not build.** Only Settings + RBAC v2 are actual work. |
| **P2 — build daily operations** (attendance, timetable, comms, calendar) | All ✅; attendance has the HIGH bug | **Phase 0** (attendance fix) + **Phase 2** (smoke/polish) | Build → **fix one bug + smoke**; add unification/shell-honesty the greenfield plan didn't foresee. |
| **P3 — build money & academic output** (fees, exams, docs, reports) | All ✅ with isolation gaps | **Phase 0** (fees/exams FK checks) + **Phase 3** (verify + consolidate + optional gateway) | Build → **harden-early (in PR-T0) then verify**; the only net-new is the *optional* real gateway. |
| **P4 — build extended ops** (admissions, transport, hostel, library, inventory, front office) | Mostly ✅; Front-Office 🟡, Import/Export 🟡, Staff master 🟡 | **Phase 4** (complete 3 partials + smoke) | Build → **complete 3 partials, smoke the rest.** |
| **P5 — build engagement/advanced** (homework, PTM, discipline, leave, dashboard, AI) | Homework ✅🟡, Discipline ✅, staff-leave ✅, Dashboard ✅🎨; PTM ⬜, student-leave ⬜, Help ⬜ | **Phase 2** (dashboard) + **Phase 5** (build the 3 missing + college homework smoke) | Build-all → **build only the 3 genuinely-missing modules**; the rest is polish/smoke. |

**Net difference:** the brief's five *build* phases become **one inserted hardening
phase + a foundation-completion phase + three verify/complete/build phases**. The
center of gravity moves from construction to **correctness, completion, and
consolidation**, exactly the master doc's headline (§1).

---

## Ordered PR list (the one-line sequence)

**PR-T0** Tenant Isolation & Correctness Hardening → **PR-T1** Tenant Settings +
Academic-Year → **PR-T2** Tenant RBAC v2 (per-tenant matrix + finer job-roles as
permission-sets) → **PR-T3** School/College Terminology + Homework college variant →
**PR-T4** Tenant Dashboard/Overview upgrade + shell-honesty + IA consolidation (grouped
nav + one Reports hub) → **PR-T5** Tenant Import/Export center → **PR-T6** Staff master
(non-teaching) → **PR-T7** Front-Office unification → **PR-T8** PTM (build) → **PR-T9**
Student-Leave (build) → **PR-T10** Tenant Help/SOP (build) → **PR-T11** AI Copilot
Phase 1.
_Off critical path (optional, any time after PR-T0, degrade gracefully): **PR-T-GW**
real payment gateway; live-classes provider API._
