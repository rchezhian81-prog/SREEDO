# Tenant Admin Master Roadmap — School & College ERP Module Completion Plan

> **Status: PLANNING ONLY.** No code, no migrations, no deployment is proposed by
> this document. It is an honest gap analysis + completion roadmap for the
> **Tenant Admin** surface of GoCampusOS (school / college / institution admin —
> *not* Super Admin, *not* the student/parent/teacher portals except as reference).
> The Super Admin platform suite (N, C, D, I, H, P, F, G, J, K, L, M, O, E, Q) is
> already completed and production-stable and is **out of scope** here except for
> safe documentation links or a real bug/security fix.

**Companion documents (this folder):**
| Doc | Contents |
|-----|----------|
| `TENANT-ADMIN-MASTER-ROADMAP.md` (this) | Gap analysis, 30-module status + feature lists, cross-cutting hardening, UI/UX, reports/exports, final recommendation |
| `MODULE-SEQUENCE.md` | The recommended build order (phases, dependencies, risks, completion criteria) |
| `SCHOOL-COLLEGE-DIFFERENCES.md` | School vs college handling, shared data model, where `institution_type` drives UI |
| `P0-MVP-SCOPE.md` | The must-have "trustworthy multi-tenant" P0 scope (included / excluded) |
| `TENANT-ADMIN-DATA-MODEL.md` | Entity-by-entity data model: what exists, isolation, gaps, re-scoping fixes |
| `TENANT-ADMIN-RBAC-PLAN.md` | Tenant role model (20 job-roles → permission-sets) + per-tenant RBAC plan |
| `TENANT-ADMIN-SMOKE-TEST-PLAN.md` | Per-module smoke-test checklists |
| `AI-COPILOT-PHASE1-PLAN.md` | GoCampus AI Copilot — Phase 1 read-only assistant plan |

---

## 1. Executive summary — the honest headline

**GoCampusOS already has a broad, largely-built tenant ERP.** A live inventory of
the real codebase (three independent sweeps: frontend pages, backend routers,
data model + RBAC) found:

- **~120 working tenant frontend pages** under `frontend/src/app/(dashboard)/`
  (a 57-item school nav, a derived college nav) — **no stub/placeholder screens,
  no "coming soon", and no Super-Admin component coupling.**
- **56 tenant backend routers** across ~50 module dirs (`backend/src/modules/`),
  almost all with real business logic (row-locking, transactions, invoice/ledger
  integration, PDF generation), **zod-validated bodies, and permission guards**.
- **A deep tenant data model** — ~90 domain tables, essentially every Fedena-class
  entity (academics school+college, students, admissions, attendance daily+period,
  deep fees, exams, timetable, transport, hostel, library, inventory, documents/TC,
  communication, discipline, staff-leave, payroll, calendar, plus infirmary, alumni,
  mess, quizzes, polls, gallery, etc.), all `institution_id`-scoped.

**Therefore this is not a build-from-scratch roadmap. It is a completion,
correctness-hardening, and consistency roadmap.** Of the 30 target Tenant Admin
modules: **23 Completed, 5 Partial, 2 Missing** (details in §3). The highest-value
work is *not* net-new features — it is:

1. **Tenant-isolation correctness & security hardening** (one real cross-tenant
   write bug; global-unique/sequence namespaces that block true multi-tenancy;
   inconsistent in-tenant FK validation). **This is the #1 priority.**
2. **Per-tenant RBAC + a finer tenant role model** (today: 5 fixed roles, one
   global permission matrix editable only from the platform console).
3. **School ↔ College unification** (the terminology engine is adopted in only
   ~20 of ~120 pages; homework is school-only).
4. **Consistency / polish / honesty** of the existing surface (flat 57-item nav,
   four overlapping "Reports" entries, emoji-icon + light-mode-only theming on
   hub pages, silent error-swallowing, and **mock shell chrome presented as
   live** — fake notification badges, a hardcoded session pill, a dead global
   search).
5. **The genuinely-missing / partial modules** (PTM, student-leave, tenant
   Help/SOP, unified Settings, Import/Export center, non-teaching Staff master,
   Front-Office unification) plus the known integration stubs (payment gateway,
   live-classes provider).
6. **A Tenant Dashboard/Overview + AI Copilot layer** as the wrap-up — mirroring
   how Super Admin closed with Overview (E) + Help (Q).

Nothing below is marked complete without evidence from the live code sweep
(Rule N.7). Where the earlier planning docs (`docs/PRD.md`,
`docs/ROLES_AND_PERMISSIONS.md`, `docs/DATABASE_SCHEMA.md`) disagree with the
live code, **the live code wins** and is cited.

---

## 2. Method & evidence

Three read-only inventory passes over `/home/user/SREEDO` on 2026-07-07:
- **Frontend** — every non-`super-admin` route under `(dashboard)/`, the nav
  arrays in `layout.tsx`, terminology/mode usage, super-admin coupling, CRUD
  pattern conformance.
- **Backend** — all 56 tenant routers mounted in `src/app.ts:192-256`, their
  guards, endpoints, tables, zod coverage, and tenant-isolation quality.
- **Data model + RBAC** — `src/db/migrations/0001…0102`, the role/permission
  model, isolation middleware, and owner-scoping.

Verdicts use six honest buckets, per Section A of the brief:
**Completed · Partial · Missing · Needs-redesign · Needs-smoke-test · Future.**

---

## 3. Gap analysis — the 30 Tenant Admin modules

Legend: ✅ Completed · 🟡 Partial · ⬜ Missing · 🎨 Needs-redesign/consistency ·
🧪 Needs-smoke-test (never end-to-end verified this cycle) · 🔭 Future.

| # | Module | Verdict | Evidence (live code) | Main gap / next step |
|---|--------|:------:|----------------------|----------------------|
| 1 | Tenant Dashboard / Overview | ✅ 🎨 | `dashboard` /stats+/charts (staff-gated, scoped) + `analytics` | No unified "needs-attention" exec overview; shell chrome is mocked (badges/session/search) |
| 2 | Academic Setup | ✅ | `academics` (years/classes/sections/subjects/class-subjects) + `college` (dept/program/sem/batch) | Global-unique names/codes (isolation, §4.1); class_subjects thinly surfaced |
| 3 | Student Management | ✅ | `students` CRUD + import + promote + guardians; Profile-v2 demographics | In-tenant `section_id` FK not validated (§4.1 low leak) |
| 4 | Admissions / Enquiry | ✅ | `admissions` public enquiry → applications → convert-to-student | — (smoke-test the enquiry→enroll flow) |
| 5 | Attendance | ✅ ⚠ | `attendance` (daily) + `periodattendance` + `biometric` | **HIGH: cross-tenant overwrite in daily `bulkMark` (§4.1)** |
| 6 | Fees / Collections | ✅ | `fees` (structures/invoices/payments/schedules/fines/discounts) + `feerefunds` + `onlinepayments` | Payment gateway adapter is a **stub**; `studentId` not ownership-checked on invoice create |
| 7 | Exams / Marks / Results | ✅ | `exams` + report-cards/mark-sheets + `grade_bands` (+GPA/CGPA college) | `upsertResults` no in-tenant student/subject check (low echo leak) |
| 8 | Timetable | ✅ | `timetable` (clash-checked, CSV) + `timetablegen` (greedy) | — (smoke-test college semester timetables) |
| 9 | Staff / HR | 🟡 | `staffleave` (attendance+leave) + `payroll` full | **No non-teaching staff master** (`teachers` overloaded); no recruitment/appraisal/onboarding |
| 10 | Teacher Management | ✅ | `teachers` CRUD + import + plan-limit | — |
| 11 | Parent / Student portal readiness | ✅ | `portal` owner-scoped aggregator + `auth` portal cookie login | In scope only as reference; portal UX is a separate track |
| 12 | Communication | ✅ | `communication` (in-app + email/SMS/push + threads + generated alerts) + `announcements` | SMS/push providers optional; smoke-test fan-out |
| 13 | Documents / Certificates | ✅ | `documents` + `pdfs` (receipts/ID-cards/certs) + `tc` (dues-gated) | — |
| 14 | Transport | ✅ | `transport` full (routes/allocations/fees→invoices/trips) | — |
| 15 | Hostel | ✅ | `hostel` full (structure/allocation `FOR UPDATE`/fees) | — |
| 16 | Library | ✅ | `library` circulation (`FOR UPDATE SKIP LOCKED`) + `reservations` | — |
| 17 | Inventory | ✅ | `inventory` stock ledger (in/out/adjust, negative-guarded) | — |
| 18 | Front Office | 🟡 | `visitors` log+checkout; enquiry/complaints/`lostfound` exist separately | No **unified** front-office surface; no postal-dispatch / call register |
| 19 | Calendar / Events | ✅ | `calendar` events CRUD + filters | — |
| 20 | Homework / Assignments | ✅ 🟡 | `homework` full lifecycle + submissions + grading | **School-only shape** (`section_id NOT NULL`); no college/semester variant |
| 21 | PTM / Parent Meetings | ⬜ | none (only `calendar_events.type='meeting'`) | **Build** (scheduling, slots, invites, attendance, notes) |
| 22 | Discipline / Behaviour | ✅ | `disciplinary` register + status machine + audit + portal flag | — |
| 23 | Leave Management | ✅ 🟡 | `staffleave` types/balances/requests/approve (**staff**) | **Student leave-application not implemented** |
| 24 | Reports / Analytics | ✅ 🎨 | `reportcenter` (~80 reports) + `reports` + `customreports` + `scheduledreports` + `aiinsights` | Four overlapping "Reports*" nav entries — consolidate IA |
| 25 | Settings / Branding / Academic Year | 🟡 | `branding` + academic-year CRUD + `college` mode-switch | **No unified tenant Settings**; institution profile is platform-owned; 3 mode-switch sources of truth |
| 26 | Tenant Admin User Management | ✅ | `users` CRUD + deactivate + 2FA-reset + unlock (`users:manage`) | — |
| 27 | Tenant-side RBAC | 🟡 | `role_permissions` enforced; admin assigns fixed roles | **Fixed 5-role enum; matrix editable only from platform console; global (not per-tenant)** |
| 28 | Import / Export | 🟡 | Import: `students`+`teachers` only; Export: per-module CSV/PDF | **No unified tenant Import/Export center** (the Data Export Center is Super-Admin) |
| 29 | Audit / Activity Log | ✅ | `activity` (own-tenant forced, Mongo `audit_logs`, degrades) | Mongo-optional; smoke-test the degraded path |
| 30 | Help / SOP for Tenant Admin | ⬜ | `help` module is **platform-only** (`help:read` never granted to tenant roles → 403) | **Build** a tenant-facing Help/SOP surface |

**Tally: 23 ✅ Completed · 5 🟡 Partial (Staff/HR, Front Office, Settings, Tenant-RBAC, Import/Export) · 2 ⬜ Missing (PTM, Tenant Help/SOP).**
Plus CLAUDE.md follow-ups grep-confirmed absent and treated as **🔭 Future / new
modules**: student-leave application, co-curricular, syllabus, substitute-teacher,
question-bank.

---

## 4. Cross-cutting hardening themes (the real high-value work)

These cut across many modules and are, collectively, the reason this roadmap
leads with hardening rather than features.

### 4.1 Tenant isolation & multi-tenancy correctness — **PRIORITY 1 (security)**

Isolation is **application-level only** (no Postgres RLS); every query must
remember `WHERE institution_id = $1`. Quality varies. Live findings:

- **HIGH — cross-tenant attendance overwrite.** `attendance.service.ts:13`
  (`bulkMark`) inserts with the caller's `institution_id` but never checks that
  `record.studentId` belongs to the tenant, and `attendance_records` has a
  **global** `UNIQUE (student_id, date)`. Its `ON CONFLICT (student_id,date) DO
  UPDATE` therefore lets an admin/teacher in tenant A overwrite tenant B's
  attendance row by supplying B's student UUID. `periodattendance` already has
  the correct in-tenant guard to copy. **Fix first.**
- **Global UNIQUE namespaces never re-scoped.** Pre-tenancy tables kept global
  constraints: `academic_years.name`, `classes.name`, `subjects.code`,
  `students.admission_no`, `teachers.employee_no`, `invoices.invoice_no` are
  **unique across ALL tenants**, and `student_admission_seq` / `teacher_employee_seq`
  are **single global sequences**. Two institutions cannot both have academic year
  "2025-2026", a class "Grade 1", subject "MATH101", or admission "ADM001". This
  is a **real multi-tenancy correctness bug** — additive migrations must convert
  each to `UNIQUE(institution_id, …)` and move numbering to per-tenant.
- **Inconsistent in-tenant FK validation (LOW read/echo leaks).** `students`
  (`section_id`), `exams` (`upsertResults` student/subject), `academics`
  (`listClasses` count), `fees` (`createInvoice` studentId) accept/join FKs
  without an in-tenant existence check, so a foreign UUID's name/label can be
  echoed back. `promoteStudents` and the college modules (`assertRef`) show the
  correct pattern to standardize on.
- **Defense in depth (Future).** Evaluate Postgres RLS or a query-builder guard
  as a safety net so a single forgotten filter can't leak.

> A dedicated **"Tenant Isolation Hardening"** PR (or small series) should land
> before/with the first feature PR. See `P0-MVP-SCOPE.md`.

### 4.2 Per-tenant RBAC + finer role model — **PRIORITY 2**

Today: `user_role` enum = `admin, teacher, accountant, student, parent`
(+`super_admin` platform); `role_permissions` is a **single global matrix** with
no `institution_id`; tenants cannot customize roles, and any grant change is
system-wide; the only RBAC editor is the **platform** console. The 20 job-roles
the brief wants (Principal, Admission Officer, Exam Controller, HOD, Librarian,
Transport Manager, Hostel Warden, Front Office, Read-only Auditor, …) should be
delivered as **permission-sets**, exactly as Super Admin delivered platform
sub-roles via `users.platform_role` — **not** by exploding the enum. This needs a
tenant-scoped role layer (`role_permissions.institution_id` + a tenant-facing role
manager). Full plan in `TENANT-ADMIN-RBAC-PLAN.md`.

### 4.3 School ↔ College unification — **PRIORITY 3**

The dual-mode goal is structurally sound (mode store + `useTerms()` engine +
`requireInstitutionType()` + additive college columns on exams/fees/timetable),
but **the terminology engine is adopted in only ~20 of ~120 pages**, so college
mode reuses school pages that still render "Class/Section" and, in a few spots,
literal "school" copy (`analytics`, `dashboard`, `branding`). **Homework is
school-only** (`section_id NOT NULL`) — needs the additive college/semester
variant the other academic modules already got. Three sources of truth for the
mode flag (`/auth/me.institutionType`, `/college/settings` toggle, pre-login
store) should be reconciled to one. Detail in `SCHOOL-COLLEGE-DIFFERENCES.md`.

### 4.4 Consistency, polish & honesty — **PRIORITY 4**

Grounded in the live frontend sweep:
- **Sidebar IA**: a flat **57-item** list, no grouping — cluster into Academics /
  Operations / Finance / Communication / Admin sections.
- **Reports IA**: four overlapping nav entries (`Reports`, `Reports Center`,
  `Report Builder`, `Scheduled Reports`) — consolidate under one "Reports" hub.
- **Theming**: hub/landing pages use **emoji icons** (🏨🛏️🚌) and
  **light-mode-only Tailwind colors** (`text-slate-900`, `bg-amber-50`) instead of
  the `<Icon>` facade + semantic tokens (`text-ink/-muted`, `bg-surface`) — they
  break in dark mode. Migrate to the design system.
- **Error handling**: many loaders `.catch(() => undefined)` (silent), and there
  are **no route-level `error.tsx`/`loading.tsx`** — backend failures render as
  empty states. Add error surfacing.
- **Shell honesty (do first — it's a trust issue)**: the Topbar shows a
  **hardcoded notification badge "5"**, **messages "3"**, a **hardcoded "2026–2027"
  session pill**, and a **non-functional global search** — all presented as if
  live. Wire them to real data or remove them; do not ship mock chrome as real.
- **Destructive UX**: replace native `confirm()` (e.g. student delete, mode
  switch) with the shared `ConfirmDialog`.

### 4.5 Integration completion — **PRIORITY 5**

- `onlinepayments` gateway adapter (`gateway.ts:104-115`) **simulates** the
  provider — wire a real gateway (Razorpay/Stripe/PayU) behind the existing
  order→checkout→webhook flow; keep it optional/degrading.
- `liveclasses` is join-link-only — optional provider API (Zoom/Meet/BBB).

Both are explicitly optional dependencies and must degrade gracefully when
unconfigured (project rule).

---

## 5. Per-module feature specification

For each module below: **Purpose · Roles · Status · Exists (live) · Gaps/next ·
Priority.** Pages/APIs/entities/reports/exports/notifications/audit/smoke are in
the companion docs (`TENANT-ADMIN-DATA-MODEL.md`, `TENANT-ADMIN-SMOKE-TEST-PLAN.md`)
to avoid duplication; this section is the authoritative feature+priority list.

Priority key: **P0** must-have (correctness/core) · **P1** important · **P2**
advanced · **🔭 Future**.

### Foundation
- **Academic Setup** — *Purpose:* the academic skeleton (year → class/section or
  dept/program/batch/semester → subjects). *Roles:* Admin (F), Principal/Academic
  Coordinator (W), Office (W). *Status:* ✅. *Gaps:* re-scope global-unique
  names/codes (4.1); surface `class_subjects`; college/school variant already
  handled. *Priority:* **P0** (blocking correctness).
- **Tenant Admin User Management** — *Purpose:* create/deactivate tenant staff
  logins, reset 2FA. *Roles:* Admin/Owner (F), Office (W). *Status:* ✅. *Priority:* **P0**.
- **Tenant-side RBAC** — *Purpose:* assign roles + (new) tune permission-sets per
  tenant. *Roles:* Owner/Admin. *Status:* 🟡. *Gaps:* per-tenant matrix + finer
  job-roles (4.2). *Priority:* **P1** (P0 for the "finer roles" the brief lists).
- **Student Management** — ✅, Admin/Office (F), Teacher (R). *Gaps:* in-tenant
  `section_id` validation. *Priority:* **P0**.
- **Teacher/Staff Management** — Teacher ✅ (**P0**); non-teaching **Staff master**
  🟡 (**P1**); recruitment/appraisal 🔭.

### Daily operations
- **Attendance** — ✅ (daily+period+biometric), Admin/Teacher (W). *Gap:* **fix
  cross-tenant write (4.1) — P0 security.**
- **Timetable** — ✅ (clash-checked + generator), Admin/Timetable Coordinator (W).
  *Priority:* **P0**.
- **Communication / Announcements** — ✅ (in-app+email/SMS/push+threads), Admin/
  Teacher (W). *Priority:* **P0** (core), providers optional.
- **Calendar / Events** — ✅, Admin (W). *Priority:* **P1**.

### Money & academic output
- **Fees / Collections** — ✅ (deep) + refunds + online, Admin/Accountant (F).
  *Gaps:* real gateway; `studentId` ownership check. *Priority:* **P0** (money).
- **Exams / Marks / Results** — ✅ + report-cards/mark-sheets + GPA, Admin/Exam
  Controller (W), Teacher (W-scoped). *Gap:* in-tenant student/subject check.
  *Priority:* **P0**.
- **Documents / Certificates** — ✅ (receipts/ID-cards/certs/TC dues-gated),
  Admin/Office (F). *Priority:* **P1**.
- **Reports / Analytics** — ✅ (~80 reports + builder + scheduled + AI insights),
  all roles (R-scoped). *Gap:* consolidate IA (4.4). *Priority:* **P1**.

### Extended operations
- **Admissions/Enquiry** ✅ **P1** · **Transport** ✅ **P1** · **Hostel** ✅ **P2** ·
  **Library** ✅ **P2** · **Inventory** ✅ **P2** · **Front Office** 🟡 **P2**
  (unify visitors+enquiry+complaints+lost-found+postal/call).

### Engagement
- **Homework/Assignments** ✅ 🟡 — add college variant. **P1**.
- **PTM** ⬜ — **build** (P2): meeting scheduling, slot booking, invites,
  attendance, notes; school+college.
- **Discipline/Behaviour** ✅ **P2**.
- **Student Leave Management** ⬜ — **build** (P2): student leave-application →
  approval → attendance integration (staff leave already ✅).
- **Parent/Student portal readiness** ✅ (reference track).

### Wrap-up layer (mirrors Super Admin E + Q)
- **Tenant Dashboard/Overview** ✅ 🎨 — upgrade to an exec "needs-attention"
  overview (attendance dips, fee outstanding, exam readiness, expiring items).
  **P1**.
- **Settings** 🟡 — **build a unified tenant Settings** (institution profile
  read, academic-year, branding, module toggles, mode, notification prefs). **P1**.
- **Import/Export center** 🟡 — **build** a unified tenant Import/Export (extend
  beyond students+teachers; reason-gate sensitive exports; audit). **P1**.
- **Audit/Activity Log** ✅ **P1** (degrades w/o Mongo).
- **Help/SOP for Tenant Admin** ⬜ — **build** a tenant-facing Help/SOP surface
  (reuse the Super-Admin Q curated-docs pattern, tenant-scoped perms). **P2**.
- **AI Copilot Phase 1** 🔭 — read-only assistant (see `AI-COPILOT-PHASE1-PLAN.md`). **P2 / Future**.

---

## 6. Tenant isolation & security requirements (every tenant module)

Non-negotiable rules for any tenant work (Section H of the brief), aligned to the
existing hard rules in `CLAUDE.md`:

1. **Tenant isolation enforced in the backend** — every read/write filtered by
   `tenantId(req)`; **validate every inbound FK (`studentId`, `sectionId`,
   `subjectId`, …) belongs to the tenant** (standardize on the `assertRef`
   pattern) before insert/echo.
2. **No cross-tenant data leakage** — no unfiltered joins to shared tables; fix
   the global UNIQUE/sequence namespaces so numbering can't collide/enumerate.
3. **Permissions enforced server-side** — `authenticate → requireTenant →
   requirePermission/authorize → owner-scope → service`; frontend hiding is not
   security.
4. **Sensitive fields masked** where shown/exported (reuse the platform
   `maskSecrets`/`maskFreeText` helpers).
5. **Sensitive exports reason-gated + audited.**
6. **Audit important actions** (create/update/delete/approve/export) to the audit
   log.
7. **No hard delete of important records** — soft-delete/archive (students already
   soft-delete; extend the pattern).
8. **Import validation required** — validate + dry-run + row-level errors before
   commit.
9. **No secrets exposed** — tokens/keys/gateway secrets/DB creds never returned.
10. **Consistency** — prefer granular `requirePermission("module:action")` over
    blanket `authorize("admin")` so teacher/accountant granularity is possible.

---

## 7. UI / UX direction (Tenant Admin)

Keep the existing GoCampusOS design system — do not invent styles. Standardize:

1. **Dashboard**: exec overview (KPI cards + needs-attention + quick actions),
   role-aware.
2. **Navigation**: **grouped** sidebar (Academics / Operations / Finance /
   Communication / Admin) replacing the flat 57-item list; role- + module-aware
   (`enabledModules`, `adminOnly`, `perm`).
3. **Search/filter/pagination**: the students-page standard (server query params).
4. **Create/Edit**: `<Modal>` + `<Field>/<Input>/<Select>` + RHF + zod (reference:
   students).
5. **Detail pages**: consistent header + tabs.
6. **Import/Export**: a shared drawer/modal pattern with dry-run preview.
7. **States**: loading / empty / error / no-results on every screen (+ add
   route-level `error.tsx`); **stop silent `.catch(()=>undefined)`**.
8. **Mobile responsive**: cards stack; tables scroll in `overflow-x-auto`.
9. **School/College labels**: adopt `useTerms()` across all academic pages.
10. **Theming**: `<Icon>` facade + semantic tokens (`bg-surface`, `text-ink/-muted`,
    `border-line`) — retire emoji icons + light-only colors; verify dark mode.
11. **Honesty**: no mock chrome (badges/session/search) presented as live.

Full detail is folded into the master doc; module screens are enumerated in
`docs/UI_PAGES.md` (existing) + the smoke plan.

---

## 8. Reports & exports (per module)

The report surface is already large (`reportcenter` ~80 reports + builder +
scheduled + custom). Roadmap actions: (a) **consolidate the four Reports nav
entries** into one hub; (b) ensure **every module** exposes its core report with
filters + **CSV** (XLSX where the native `toXlsx` helper fits) + **PDF where
useful**; (c) **reason-gate + audit** sensitive exports (student PII, fees,
payroll, disciplinary); (d) unify these under the new **tenant Import/Export
center**. Detail per module in `TENANT-ADMIN-SMOKE-TEST-PLAN.md`.

---

## 9. Final recommendation (see also §M summary in chat)

**Build order** (full rationale in `MODULE-SEQUENCE.md`):

- **PR-T0 — Tenant Isolation & Correctness Hardening (P0, do first).** Fix the
  attendance cross-tenant write; re-scope global UNIQUE namespaces + sequences to
  per-tenant; add in-tenant FK validation to students/exams/fees/academics;
  regression + new isolation tests. *Why first:* it is a live security/correctness
  issue and every later module inherits the pattern.
- **PR-T1 — Tenant Settings + Academic-Year (P0/P1).** The unified settings home
  every other module links to; reconcile the mode-switch sources of truth.
- **PR-T2 — Tenant RBAC v2 (P1).** Per-tenant `role_permissions` + a tenant role
  manager + the finer job-roles as permission-sets.
- **PR-T3 — School/College Terminology + Homework college variant (P1).**
- **PR-T4 — Tenant Dashboard/Overview upgrade + shell-honesty fixes (P1).**
- **PR-T5+ — Missing/partial modules**: Import/Export center → Staff master →
  Front-Office unification → PTM → Student-Leave → Tenant Help/SOP → AI Copilot P1.

**Which module to build first, and why:** **PR-T0, the Tenant Isolation & Correctness
Hardening pass.** It is the only item with an exploitable cross-tenant write, it
unblocks true multi-tenant operation (global-unique bug), and it establishes the
in-tenant-FK-validation pattern every subsequent module depends on — exactly the
"correctness before features" posture the Super Admin suite followed. It is small,
high-certainty, and fully testable.

**Suggested next PR prompt (after your approval):**
> "Tenant Hardening T0: Tenant Isolation & Multi-Tenancy Correctness — fix the
> daily-attendance cross-tenant overwrite, re-scope the global UNIQUE namespaces
> and admission/employee sequences to per-tenant (additive migrations), add
> in-tenant FK validation to students/exams/fees/academics, with regression +
> new cross-tenant isolation tests. No new features; open PR first, no deploy."

**Rules honored:** planning only; no code; no deploy; Super Admin untouched; no
completed-module rewrite; gaps stated honestly with code evidence; nothing marked
complete without proof; build one module at a time like the Super Admin suite;
await approval before the first implementation PR.
