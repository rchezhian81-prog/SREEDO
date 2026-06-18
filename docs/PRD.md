# Product Requirements Document — SRE EDU OS

> **SRE EDU OS** is a modern, multi-tenant School / College ERP — a Fedena-class
> platform with a clean, premium, soft-3D UI. This PRD is the master functional
> specification. It describes the **full target product** and marks, per
> capability, what exists **today** versus what is **planned**, so it doubles as
> the source of truth for the roadmap in [`DEV_ROADMAP.md`](./DEV_ROADMAP.md).

| | |
|---|---|
| **Product** | SRE EDU OS — School / College ERP |
| **Owner** | rchezhian81@gmail.com (non-technical product owner) |
| **Version** | 1.0 (PRD baselined against the implemented MVP) |
| **Last updated** | 2026-06-18 |
| **Related docs** | [Architecture](./ARCHITECTURE.md) · [DB Schema](./DATABASE_SCHEMA.md) · [API](./API_REFERENCE.md) · [Roles](./ROLES_AND_PERMISSIONS.md) · [Workflows](./MODULE_WORKFLOWS.md) · [UI Pages](./UI_PAGES.md) · [Roadmap](./DEV_ROADMAP.md) · [Handover](./DEVELOPER_HANDOVER.md) |

**Status legend used throughout this document:**

- ✅ **Implemented** — built and verified in the current codebase
- 🟡 **Partial** — foundations exist; listed sub-features are missing
- ⬜ **Planned** — not started; on the roadmap

---

## 1. Vision & goals

Build a **modern, scalable, secure, user-friendly** ERP that runs the day-to-day
operations of both **schools and colleges**, from a single backend that serves a
web admin app, a mobile app, and (later) self-service portals for parents and
students.

**Product goals**

1. **One system, many institutions** — multi-tenant from the data model up, so a
   group can run many campuses/branches under one deployment.
2. **Configurable for school *and* college** — terms vs. semesters, classes vs.
   departments/courses, the same engine adapts via configuration, not forks.
3. **Premium, simple UX** — soft-3D dashboard cards, clear menus, search,
   filters, export and print. Usable by non-technical office staff.
4. **Secure by default** — JWT auth, RBAC + permissions, rate limiting, input
   validation, audit logs, secure uploads, HTTPS-ready.
5. **AI-native** — GPT-4o assistant grounded in live data, plus embeddings-based
   document search and proactive risk alerts.
6. **API-first** — every feature is a documented REST endpoint (Swagger) reused
   identically by web and mobile.

**Non-goals (v1)**

- Public marketing website / CMS.
- Built-in payment *gateway* processing — the architecture is integration-ready
  (invoices, payments, methods) but we ship adapters, not a PCI cardholder vault.
- Learning-management depth (SCORM, proctored online exams). Homework and study
  materials are in scope; a full LMS is not.

## 2. Personas & target users

| Persona | What they need | Primary surface |
|---------|----------------|-----------------|
| **Super Admin** | Create institutions, branches, packages; global settings, backups, audit | Web (super-admin) |
| **Institution Admin / Principal** | Run a campus: academics, staff, students, fees, reports | Web |
| **Vice Principal** | Academic oversight, approvals, reports | Web |
| **Accountant** | Fee structures, invoices, payments, receipts, dues reports | Web |
| **Office Staff** | Admissions, records, certificates, day-to-day data entry | Web |
| **Teacher** | Attendance, marks, homework, timetable, communication | Web + Mobile |
| **HR / Payroll Staff** | Staff records, leave, payroll, payslips | Web |
| **Librarian** | Catalogue, issue/return, fines, stock | Web |
| **Transport Manager** | Vehicles, drivers, routes, allocations | Web |
| **Hostel Warden** | Rooms, allocations, occupancy, hostel fees | Web |
| **Parent** | Child's attendance, marks, fees, homework, notices, messaging | Mobile + Web portal |
| **Student** | Own timetable, attendance, results, homework, materials, fees | Mobile + Web portal |

> **Today:** the platform models 5 roles (`admin`, `teacher`, `accountant`,
> `student`, `parent`). The remaining 8 roles in the matrix are delivered by
> expanding the role/permission system — see
> [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md).

## 3. Scope: school vs. college configurability

The platform supports both via an **institution `type` + academic-term model**:

| Concept | School mode | College mode |
|---------|-------------|--------------|
| Top academic unit | Class (e.g. Grade 10) | Department → Course/Program |
| Cohort grouping | Section | Section / Batch |
| Time division | Academic year → Terms | Academic year → Semesters |
| Curriculum unit | Subject | Subject / Paper (per semester) |
| Promotion | Grade level → next | Semester progression |

> **Today:** the academic model (`academic_years`, `classes`, `sections`,
> `subjects`, `class_subjects`) covers **school mode**. College mode (✅ Phase B,
> migration `0023`) adds `departments`, `programs/courses`, `semesters`,
> `batches`, `program_subjects` (with credits), `enrollments`, and
> `staff_allocations` — the same students/exams/fees engines reuse them, and an
> institution switches modes via its `type`.

## 4. Functional modules (the 20)

Each module below lists its **purpose**, **key capabilities**, **status**, and
the **phase** it lands in (see [`DEV_ROADMAP.md`](./DEV_ROADMAP.md)). Detailed
flows are in [`MODULE_WORKFLOWS.md`](./MODULE_WORKFLOWS.md).

### 4.1 Super Admin Panel — 🟡 Partial (Phase A)
- ✅ `super_admin` role; institution & branch/campus CRUD; subscription
  **package** management and per-institution **subscriptions** — backend
  (`/api/v1/institutions|branches|packages`, migration `0011`) **and** a
  dedicated Super Admin **web console** (`/super-admin`).
- ✅ Full tenant data isolation: `institution_id` is enforced (`NOT NULL`) and
  every module scopes its queries to the caller's institution (`requireTenant`
  middleware), proven by cross-tenant integration tests.
- ⬜ Global user-role management, system settings, backup & restore, global
  audit-log viewer.

### 4.2 School / College Admin Panel — 🟡 Partial
Dashboard ✅; academic-year/class/section/subject setup ✅; **department,
program/course, semester, enrollment & staff-allocation setup ✅ (college mode)**;
staff management 🟡; student management 🟡; parent
management ⬜; fee structure setup ✅; transport/hostel/exam setup 🟡/⬜;
reports 🟡.

### 4.3 Student Management — 🟡 Partial
- ✅ Admission (create) with auto admission numbers, profile, status lifecycle
  (active/inactive/graduated/transferred), section assignment, guardian fields,
  and **soft-delete** (archive) that preserves attendance/fee history.
- ⬜ Document upload, ID-card details, disciplinary records, transfer-certificate
  (TC) generation. Attendance/fees/exam links exist via their modules.

### 4.4 Staff / Teacher Management — 🟡 Partial
- ✅ Profile, auto employee numbers, qualification/specialization, active status,
  assigned subjects/sections (`class_subjects`).
- ⬜ Staff attendance, timetable, salary/payroll, leave management, performance
  records, document upload.

### 4.5 Parent Portal — ✅ Built (Phase C, base)
Cookie-authenticated portal where a parent views **only their linked children**
(via the `guardians` table): child profile, attendance summary, timetable, fee
status and notices, with a child selector for multiple children. Homework and
teacher communication remain ⬜ (later Phase C).

### 4.6 Student Portal — ✅ Built (Phase C, base)
Cookie-authenticated portal where a student views **only their own** profile,
attendance summary, timetable, fee status and notices. Owner-scoping enforced
server-side. Homework/results detail and study materials remain ⬜.

### 4.7 Attendance — 🟡 Partial
- ✅ Student daily attendance: bulk upsert per section/date, per-section view,
  per-student history, statuses present/absent/late/excused, dashboard counts.
- ⬜ Staff attendance, monthly/yearly report exports, SMS/app absence
  notifications, period-wise attendance.

### 4.8 Fee Management — 🟡 Partial
- ✅ Fee structures (class/year, frequency), invoices with unique numbers,
  payments with **overpay guard**, status lifecycle, multiple methods, summary.
- ✅ **Payment receipt PDF** (owner-scoped download from the fee page + portal),
  on the shared pdfkit utility.
- ⬜ Fee categories, term-wise schedules, **fine** rules, **discount/scholarship**,
  online-payment gateway adapter, class-wise/student-wise dues reports.

### 4.9 Exam & Result Management — ✅ Built
- ✅ Exam creation, bulk mark entry (web **Exams & Results** page with a
  per-section/subject grid), per-exam results, per-student report.
- ✅ **Grade-band scale** setup, total/percentage/grade computation, **report-card
  PDF** (per student) and printable **mark-sheet PDF** (per section), generated
  with pdfkit from the exam results. Owner-scoped downloads (student→self,
  parent→linked child) + `report_cards:*` / `mark_sheets:export` permissions.
- ✅ **College GPA/CGPA foundation** — semester-tagged exams + credit-weighted
  grade points (`grade_bands.grade_point` × `program_subjects.credits`) compute
  a per-semester GPA and cumulative CGPA, exposed owner-scoped via
  `/college/students/:id/...`. ⬜ Subject-wise analytics screens.

### 4.10 Timetable Management — ✅ Built (Phase B)
Period & room masters, per-section timetable entries (subject/teacher/room per
day & period), class and teacher timetable views, CSV export, and **conflict
checking** that prevents teacher, room and section double-booking (enforced in
the service and by race-safe partial unique indexes). Tenant-scoped, with
`timetable:read|create|update|delete|export` permissions.

### 4.11 Homework / Assignment — ✅ Built (Phase C)
Teacher assigns homework to a section + subject (title, description, instructions,
due date, optional marks) with attachments; students view in the portal and
submit text and/or a file; teachers list submissions and review/grade
(reviewed/completed/late/resubmit + marks/remarks). Parents view their child's.
Attachments reuse the object-storage layer via a protected, owner-scoped download
route; assign/submit fire in-app + best-effort email/SMS/push notifications.
Tenant + owner scoped; `homework:read|create|update|delete|submit|review` permissions.

### 4.12 Communication — ✅ Built (base)
- ✅ Notice board / announcements with audience targeting and pinning.
- ✅ **In-app messaging** with per-recipient read/unread inbox, audience targeting
  (all students/parents, staff, class, section, individual student/parent/user),
  sent history + delivery (read) counts, and a staff console + portal/staff inbox.
- ✅ **Email/SMS/FCM-push adapters** (all optional, degrade gracefully when
  unconfigured) + **device-token** registration; **fee reminders** (from invoices)
  and **absence alerts** (from attendance, de-duplicated per student/day).
  Tenant-scoped + owner-scoped; `communication:*` / `notifications:send` permissions.
- ⬜ Threaded 1:1 messaging and scheduled campaigns.

### 4.13 Library Management — ✅ Built (Phase D)
Catalogue (categories, book master with ISBN/author/publisher/edition/subject/
language/rack, per-copy tracking with status available/issued/lost/damaged/
retired), members (student/staff, college students included), issue/return/renew
with configurable loan period + borrowing limit, **auto late-fine** calculation
(per-day rate) that can be **waived** or **posted to a student invoice** (Fees
module). 6 reports (stock, issued, overdue, member history, lost/damaged, fines).
`library:*` permissions, tenant-scoped, with an owner-scoped portal history
endpoint (migration `0024`).

### 4.14 Transport Management — ✅ Built (Phase D)
Vehicle master (with insurance/fitness/permit expiry + capacity) and driver
master (license + expiry + helper); routes with assigned vehicle/driver; ordered
stops (pickup/drop times, zone, distance); student route/stop allocation
(school + college students). **Route- or stop-level fee mapping** with idempotent
**transport invoice generation** into the Fees module (stop fee overrides route
fee) and a transport-fee dues report. Daily **trip-log** foundation
(scheduled/completed/cancelled). 7 reports (route-/stop-wise students, vehicles,
drivers, fee dues, occupancy, document expiry). `transport:*` permissions,
tenant-scoped, with an owner-scoped portal allocation endpoint (migration `0025`).
Optional live tracking feed for the parent app remains ⬜.

### 4.15 Hostel Management — ✅ Built (Phase D)
Hostel master (type boys/girls/co-ed/staff, warden + contact), **blocks** and
**rooms** (floor, room type, capacity, status available/occupied/maintenance/
inactive). Student room/bed allocation (school + college) with **capacity
enforcement** + one-active-allocation/one-occupant-per-bed guards, plus **room
transfer** and **vacate** (status active/vacated/transferred). **Hostel- or
room-type-level fee mapping** with idempotent **invoice generation** into the
Fees module and a hostel-fee dues report. 6 reports (hostel students, room
allocation, occupancy/vacancy, fee dues, vacated history, maintenance rooms).
`hostel:*` permissions, tenant-scoped, with an owner-scoped portal allocation
endpoint (migration `0026`).

### 4.16 Inventory Management — ✅ Built (Phase D)
Item categories + item master (unit, opening/min/current stock, location), vendor
master (contact/GST/terms). **Purchases (stock-in)** with multi-line entry +
optional document attachment increase stock; **stock issues (stock-out)** to
department/staff/student/event decrease stock and **reject when insufficient**;
**stock adjustments** (damage/lost/correction, signed) with a negative guard.
`current_stock` is an authoritative running balance maintained transactionally
(row-locked), with a **stock-movements audit ledger** (one row per change, with
the resulting balance). 7 reports (stock register, low stock, purchases, issues,
vendor-wise purchases, item movement history, damaged/lost). `inventory:*`
permissions, tenant-scoped (migration `0027`).

### 4.17 Payroll Management — ⬜ Planned (Phase D)
Salary structure, allowances/deductions, monthly salary generation, payslip PDF,
salary reports. (Reuses staff records + finance patterns.)

### 4.18 AI Features — 🟡 Partial
- ✅ AI **admin assistant** (GPT-4o) grounded in live school statistics, with
  conversation history persisted in MongoDB; degrades to 503 without a key.
- ⬜ AI report summaries, student-performance analysis, fee-pending summary,
  **attendance-risk alerts**, **embeddings document search**, workflow
  suggestions. *(All build on the existing AI service + a vector store.)*

### 4.19 Reports — 🟡 Partial
- ✅ Dashboard KPIs, fee summary, per-student exam report, attendance views.
- ✅ **Reports Center**: 10 cross-module reports (students, staff, attendance,
  fee collection, fee dues, exam results, homework, communication, documents,
  timetable) with filters and **CSV/PDF export + print**, permission-gated +
  tenant-scoped (`reports:center:*` + per-area read permissions).
- ⬜ Scheduled reports and a **custom report builder**. (See report list per module in
  [`MODULE_WORKFLOWS.md`](./MODULE_WORKFLOWS.md).)

### 4.20 Security — 🟡 Partial (see §6)
- ✅ JWT auth, role-based access, rate limiting, zod input validation, bcrypt
  password hashing, audit logs (Mongo), parameterized SQL, HTTPS-ready (nginx),
  **owner-scoped reads** (student role; parent pending its link).
- ⬜ Fine-grained **permission** layer (beyond role gates), secure **file
  uploads** to object storage, automated **backup** job, httpOnly-cookie token
  option.

## 5. Non-functional requirements (NFRs)

| Area | Requirement |
|------|-------------|
| **Performance** | P95 API < 300 ms for list/detail at seed scale; pagination on all list endpoints (✅ pattern exists). |
| **Scalability** | Stateless API (horizontal scale behind nginx); connection-pooled Postgres; multi-tenant data partitioning by `institution_id`. |
| **Availability** | `/health` liveness ✅; target 99.5% on a single VPS; graceful degradation when Mongo/OpenAI/SMTP are down ✅. |
| **Security** | See §6. |
| **Usability** | Soft-3D premium UI, responsive (desktop/tablet/mobile), ≤3 clicks to core tasks, consistent search/filter/export/print. |
| **Accessibility** | WCAG 2.1 AA target: keyboard nav, labels, contrast. |
| **Internationalization** | UTF-8 throughout; currency/date locale config; copy externalizable (future). |
| **Observability** | Structured request logging (morgan ✅); audit trail ✅; error handler with consistent envelope ✅. |
| **Maintainability** | Clean modular architecture (routes/schema/service ✅), TypeScript everywhere ✅, generated API docs ✅. |
| **Portability** | Dockerized; runs on any Docker host / Hostinger VPS ✅. |

## 6. Security requirements (detail)

All 11 requirements from the brief, with status:

1. **JWT authentication** ✅ — 15-min access tokens + rotating SHA-256-hashed refresh tokens.
2. **Role-based access control** ✅ — `authorize(...roles)` middleware on routes.
3. **Permission-based access** 🟡 — granular `permissions`/`role_permissions`
   with a `requirePermission` middleware and a seeded role matrix (migration
   `0012`, `GET /auth/permissions`); routes migrate to it incrementally (the
   users module is the first consumer).
4. **Rate limiting** ✅ — global API limiter + stricter login limiter.
5. **Input validation** ✅ — zod schemas on every request body/query.
6. **Password hashing** ✅ — bcrypt; all sessions revoked on password change.
7. **Audit logs** ✅ — mutating requests logged to MongoDB when connected.
8. **Secure file uploads** ✅ — S3-compatible object-storage adapter (local-disk
   fallback for dev), MIME+extension+size validation, safe generated names, and a
   protected owner-scoped download route (private storage keys never exposed).
9. **API validation** ✅ — schema validation + central error envelope.
10. **HTTPS/SSL ready** ✅ — nginx reverse proxy; certbot steps documented.
11. **Backup strategy** 🟡 — documented (nightly `pg_dump` off-box); automation ⬜.

Additional hardening tracked in [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md) §8
(owner-scoping reads, soft-delete students, restrict Swagger in prod, token
storage, sequence-based numbering, invoice `amount_paid` column).

## 7. AI features (architecture summary)

- **Assistant** ✅ — GPT-4o with a system prompt seeded by live KPIs (counts,
  dues, attendance), history in Mongo. Endpoint: `POST /api/v1/ai/assistant`.
- **Embeddings search** ⬜ — OpenAI embeddings over students/notices/documents
  stored in a vector index (pgvector or Mongo Atlas), surfaced as semantic
  search.
- **Analytical summaries & risk alerts** ⬜ — scheduled jobs that summarize fees
  due, attendance risk (consecutive absences), and performance dips into the
  dashboard and notifications.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §AI for data flow. Every AI feature is
**optional** and degrades gracefully when `OPENAI_API_KEY` is unset.

## 8. Assumptions, constraints, dependencies

- **Single-currency per institution** initially (₹ default); multi-currency later.
- **PostgreSQL is the system of record**; MongoDB is optional (audit + AI only).
- **OpenAI / SMTP / object storage / SMS** are external, optional integrations.
- **Hostinger VPS + Docker Compose** is the reference deployment target.
- Mobile app currently read-only (v0.1); write features land with the portals.

## 9. Success metrics

| Metric | Target |
|--------|--------|
| Time to record a full class's attendance | < 60 seconds |
| Time to issue an invoice + record payment | < 90 seconds |
| Admin onboarding (first useful action) | < 1 day, no training |
| API uptime | ≥ 99.5% |
| Critical security findings open | 0 before public portal launch |

## 10. Current implementation snapshot (2026-06-18)

**Working & verified end-to-end:** auth (login/refresh/logout/me/change-password)
✅, RBAC ✅, users CRUD ✅, students CRUD ✅, teachers CRUD ✅, academics
(years/classes/sections/subjects) ✅, attendance bulk + views ✅, exams + results
+ report ✅, fees (structures/invoices/payments/summary, overpay-guarded) ✅,
announcements ✅, dashboard KPIs ✅, AI assistant ✅, Swagger ✅, seed data ✅,
Docker Compose ✅, CI ✅, 11 unit tests passing ✅.

**Clients:** Next.js web admin (login, dashboard, students, teachers, classes,
attendance, exams, fees, announcements, assistant, users) ✅; Flutter app
(dashboard, notices, profile) 🟡 unverified.

This snapshot is the **MVP baseline** the brief asked for. Everything in §4 marked
🟡/⬜ is the path from MVP → full ERP, sequenced in [`DEV_ROADMAP.md`](./DEV_ROADMAP.md).

## 11. Glossary

- **Institution / Tenant** — a school or college org; the multi-tenant boundary.
- **Branch / Campus** — a physical location under an institution.
- **Section** — a cohort within a class (e.g. 10-A).
- **Invoice** — a fee charge against a student; settled by one or more payments.
- **Audience** — targeting tag on announcements (all/teachers/students/parents/staff).
- **Owner-scoping** — restricting read results to the records a user owns
  (e.g. a parent sees only their child).
