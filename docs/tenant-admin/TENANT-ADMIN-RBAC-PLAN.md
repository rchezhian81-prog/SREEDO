# Tenant Admin — Role & Permission Plan (20 job-roles → permission-sets)

> **Status: PLANNING ONLY.** No code, no migrations. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` (canonical) and the direct expansion of its
> **§4.2 (Per-tenant RBAC + finer role model, PRIORITY 2)** and build item
> **PR-T2**. This plan delivers the brief's 20 tenant job-roles **as
> permission-sets, not new enum values** — exactly how the Super Admin suite
> delivered platform sub-roles (`users.platform_role` + `rbac_roles`, migration
> 0093) — and adds a per-tenant grant layer so a tenant can tune roles without
> affecting other tenants.

---

## 1. Current state (authoritative, from live code)

Verified in `0012_permissions.sql`, `0023_college_mode.sql`, `0093_rbac_roles.sql`,
`middleware/permissions.ts`, `utils/scope.ts`:

- **Base roles are a fixed enum.** `user_role` = `admin, teacher, accountant,
  student, parent` (+ `super_admin`, platform-only). A tenant admin can only
  assign one of these to a staff login.
- **Permissions are a single GLOBAL matrix.** `permissions(id, key UNIQUE,
  description)` + `role_permissions(id, role TEXT, permission_id, UNIQUE(role,
  permission_id))` — **there is no `institution_id` anywhere in this matrix**
  (0012:15-20). One row set governs *every* tenant.
- **`role_permissions.role` is free TEXT** (0012:17) — it already holds tenant
  enum roles, `super_admin`, **and** the platform custom-role keys
  (`owner`/`platform_admin`/…). This is the seam the tenant layer plugs into.
- **Grants are seeded per-feature-migration.** Each module migration `INSERT`s
  its `module:action` keys and wires them to roles (e.g. 0012 seeds
  `students:*`, `attendance:read/mark`, `fees:read/manage/summary`,
  `users:manage`, `reports:view`; 0023 seeds `college:*`, `departments:*`,
  `programs:*`, `semesters:*`).
- **The only RBAC editor is the PLATFORM console** (`/platform/rbac`). Tenants
  cannot edit grants; any change there is **system-wide** across all tenants.
- **Enforcement** = `requirePermission("module:action")` (`permissions.ts:145`),
  run after `authenticate`; tenant roles resolve their keys from
  `role_permissions` by `user_role`; **`super_admin` bypasses** (owner / NULL
  `platform_role` → full). The resolver caches a **global** `Map<string,
  Set<string>>` keyed by role string only — **no institution dimension**
  (`loadRolePermissions()`), which is precisely why per-tenant grants aren't
  possible today.
- **Owner-scoping** (`utils/scope.ts`): `STAFF_ROLES = [admin, teacher,
  accountant]` see all; `student`/`parent` are narrowed to own/children rows
  (`accessibleStudentIds` → `guardians` link, migration 0016/0070).
- **Tenant isolation** is by `users.institution_id` on every query (app-level,
  no RLS — see `TENANT-ADMIN-DATA-MODEL.md` §5).

**Net:** no tenant custom roles; the 20 job-roles the brief wants (Principal,
Exam Controller, Librarian, HOD, …) have **no home** in today's 5-role enum, and
the matrix that could express them is global and platform-owned.

---

## 2. The 20 job-roles → permission-set matrix

Each job-role is a **named bundle of `module:action` keys** layered on a coarse
base enum role — **not** a new enum value (delivery model in §3). Keys reuse the
existing convention; exact verbs follow each module's seeded catalogue
(`:read` / `:create` / `:update` / `:delete`, or `:read` / `:manage`, plus
domain verbs like `attendance:mark`, `fees:summary`). Approval/Export are
called out because master §6 (rules 5/6) requires them to be discrete,
audited grants.

**Column key:** Base = coarse enum gate · V/E/D = View/Edit/Delete ·
Appr = approval authority · Exp = export authority · Sens = sensitive-data
(PII/financial/disciplinary) access.

| # | Job-role | Base | Core permission-set (module:action) | V/E/D | Appr | Exp | Sens | School vs College |
|---|---|---|---|:--:|---|:--:|:--:|---|
| 1 | **Institution Owner / Management** | admin | `*` (all tenant keys) + `users:manage`, tenant `rbac:manage` | V/E/D | all | ✅ | full | Both; the "never locked out" role (§4) |
| 2 | **Principal / Head** | admin | all academic + ops **read/manage**, `reports:view`, `communication:manage`, `disciplinary:*`; excludes billing-secret + `users:manage` unless granted | V/E/D | leave, disciplinary, fee-waiver | ✅ | full | Both |
| 3 | **Admin Officer** | admin | `students:*`, `academics:manage`, `documents:*`, `communication:manage`, `calendar:*`, `admissions:*` | V/E/D | admissions | ✅ | PII | Both |
| 4 | **Academic Coordinator** | admin | `academics:manage`, `timetable:manage`, `exams:read`, `homework:*`, `reports:view` | V/E | — | ✅ | low | **School**: classes/sections; **College**: programs/semesters (`college:*`) |
| 5 | **Admission Officer** | admin | `admissions:*`, `students:create`, `students:read`, `documents:read`, `communication:manage` | V/E | convert-to-student | ✅ | PII | School class vs college program intake |
| 6 | **Fees / Accounts Officer** | **accountant** | `fees:read/manage/summary`, `feerefunds:*`, `onlinepayments:read`, `payroll:read`, `reports:view` | V/E | refunds, discounts, waivers | ✅ ($) | **financial** | Both |
| 7 | **Exam Controller** | admin | `exams:manage`, `exams:read`, `grade_bands:manage`, `reports:view`, mark-sheet/report-card export | V/E/D | result publish/lock | ✅ | grades | School grades vs college GPA/CGPA |
| 8 | **Attendance Officer** | admin | `attendance:read`, `attendance:mark`, `reports:view` | V/E | — | ✅ | low | **School** daily vs **College** period attendance |
| 9 | **Timetable Coordinator** | admin | `timetable:manage`, `timetable:read`, `academics:read` | V/E/D | — | ✅ | none | School section vs college semester timetable |
| 10 | **Transport Manager** | admin | `transport:*` (routes/allocations/fees→invoices/trips), `reports:view` | V/E/D | route/fee changes | ✅ | low | Both |
| 11 | **Hostel Warden** | admin | `hostel:*` (structure/allocation/fees), `disciplinary:read` | V/E/D | allocation | ✅ | low | Both (college-leaning) |
| 12 | **Librarian** | admin | `library:*` (catalogue/circulation/reservations), `reports:view` | V/E/D | — | ✅ | none | Both |
| 13 | **Inventory Manager** | admin | `inventory:*` (stock ledger/purchases/vendors), `reports:view` | V/E/D | purchase approve | ✅ | low | Both |
| 14 | **HR / Admin Staff** | admin | `teachers:*`, staff master, `staff_attendance:*`, `leave:*` (staff), `payroll:manage`, `reports:view` | V/E/D | **staff leave**, payroll run | ✅ ($) | **staff PII + payroll** | Both |
| 15 | **HOD** *(college)* | teacher | `college:read`, `departments:read`, `programs:read`, `program_subjects:read`, `exams:read`, `attendance:read`, `staff_allocations:read` scoped to own dept | V/E (dept) | dept-level leave/marks | ✅ (dept) | low | **College-only** |
| 16 | **Class Teacher** | teacher | `students:read`, `attendance:mark`, `exams:manage` (own section), `homework:*`, `communication:manage`, `disciplinary:create` | V/E (own section) | homework, section leave | scoped | class PII | **School** section-scoped; college analog = Batch Mentor / Faculty Advisor |
| 17 | **Subject Teacher** | teacher | `students:read`, `attendance:mark`, `exams:manage` (own subject), `homework:*` (own subject) | V/E (own subject) | own-subject marks | scoped | low | **School** subject vs **College** course faculty |
| 18 | **Read-only Auditor** | admin | every `*:read` / `reports:view` key, **no** create/update/delete/approve | **V only** | — | ✅ | read-only | Both (mirrors platform `auditor`, 0093:43) |
| 19 | **Front Office / Reception** | admin | `visitors:*`, `admissions:read`, `communication:read`, `students:read`, `documents:read`, enquiry/complaints/lost-found read | V/E (front-desk) | — | limited | limited PII | Both; unifies the front-office surface (master §3 #18) |
| 20 | **Custom role** | admin/teacher/accountant | **tenant-defined** subset, built in the tenant role manager (§3) | tenant-set | tenant-set | tenant-set | tenant-set | Both |

**Notes.**
- Rows 1–14, 18–20 sit on the **admin/accountant** coarse gate; rows 15–17 on
  **teacher** (they inherit staff owner-scoping but are further narrowed by
  section/subject/dept scope in the service, extending `utils/scope.ts`).
- **Approval** and **Export** are *separate* grants (e.g. `fees:refund_approve`,
  `*:export`) so a viewer isn't implicitly an approver/exporter — required by
  master §6 rules 5–6.
- **Sensitive-data** access (student PII, fees/payroll, disciplinary) is masked
  where shown/exported (`maskSecrets`/`maskFreeText`, master §6 rule 4) and
  reason-gated + audited on export (rule 5).
- **School↔College** differences are handled by the terminology engine + the
  `requireInstitutionType()` guard already in place — the *role* is the same
  bundle; only the noun and the class/section-vs-program/semester target change.

---

## 3. Delivery model — permission-sets, not enum values

**Mirror Super Admin H exactly (migration 0093).** That suite did **not** add
platform roles to the `user_role` enum. It added:
1. `rbac_roles(key PK, name, kind[built_in|custom], status, is_owner, is_system,
   …)` — role *metadata / templates*;
2. grants stored in the **existing** `role_permissions` keyed by the role's TEXT
   `key` (no new permission keys invented);
3. a per-user assignment column **`users.platform_role`** (CHECK relaxed so
   custom keys are allowed; values validated against `rbac_roles.key`);
4. **code** enforcement: `requirePermission` resolves a platform user's
   effective keys from their `platform_role` (`permissions.ts:127-138`), with
   `owner`/NULL → full access.

**The tenant equivalent (PR-T2), all additive:**

1. **Keep the 5 base enum roles** (`admin/teacher/accountant/student/parent`) as
   the **coarse gate** — unchanged, so every existing session/test/deploy is
   unaffected.
2. **Add a tenant role catalogue.** Either extend `rbac_roles` with a nullable
   `institution_id` + `scope IN ('platform','tenant')`, or add a parallel
   `tenant_roles(institution_id, key, name, kind, status, is_primary_admin, …)`.
   Seed the **20 job-roles above as `built_in` templates** (like 0093 seeded the
   6 platform templates); tenants clone/tune them into `custom` roles.
3. **Make grants per-tenant.** Add **`role_permissions.institution_id`**
   (nullable). `NULL` = the global default template (today's behaviour, fully
   backward-compatible); a non-null row = that tenant's override. This is the
   single schema change that turns the global matrix into a per-tenant one.
4. **Add a per-user assignment** `users.tenant_role` (nullable custom-role key,
   the direct analog of `platform_role`; relaxed CHECK, validated against the
   tenant role catalogue).
5. **Update the resolver.** `loadRolePermissions()`'s cache key must become
   `(institution_id, role)` instead of `role` alone, and `userHasPermission`
   must resolve a tenant user's keys from `tenant_role` (scoped to their
   `institution_id`) when set, else fall back to the base `user_role` matrix
   (`institution_id IS NULL` template). `super_admin` bypass is untouched.
6. **Add a tenant-facing role manager UI** (mirror `/platform/rbac`, tenant-
   scoped): assign job-roles to staff, clone a template into a custom role,
   toggle grants within the tenant. Bust the caches on edit
   (`invalidatePermissionCache` + a tenant-role analog of
   `invalidatePlatformRoleCache`) so changes take effect without re-login.

**Why not explode the enum:** enum changes are non-additive, ripple through
`authorize()`, `scope.ts`, types, and every migration's seed — the exact
anti-pattern Super Admin H avoided. Permission-sets keep coarse gating stable
while giving unlimited role granularity per tenant.

---

## 4. Enforcement, owner-scoping, audit & the "admin never locked out" rule

- **Layering (unchanged, extended):** `authenticate → requireTenant →
  requirePermission("module:action") → owner-scope (scope.ts) → service
  in-tenant-FK check`. Frontend hiding is never security (master §6 rule 3). The
  new tenant-role resolution slots into the existing `requirePermission` — no
  new guard type.
- **Owner-scoping** stays in `utils/scope.ts`; job-roles 15–17 (HOD/Class/
  Subject teacher) need it **extended** with section/subject/dept scope sets
  (the service already has the `assertRef`/`accessibleStudentIds` pattern to
  build on).
- **Audit every grant change.** Role assignment, template clone, and per-tenant
  grant edits log to the audit log (Mongo `audit_logs`, degrades gracefully) +
  the `activity` module, with actor + `institution_id` + before/after — exactly
  as the platform RBAC console audits (master §6 rule 6).
- **"Admin never locked out" (mirror owner-safety).** Migration 0093 protects
  the last active `owner` and gives `is_owner`/NULL full-access bypass. The
  tenant layer needs the same guarantee: the base **`admin`** enum role always
  retains full tenant access and **cannot be emptied** by a bad grant edit; at
  least one active full-access admin per tenant is protected (an
  `is_primary_admin` flag on the tenant role, non-deletable), and the platform
  console retains an override to restore a tenant that locks itself out. A
  custom role can be narrowed freely; the primary admin cannot.

---

## 5. Migration / rollout note (additive; aligned to master §4.2 + PR-T2)

> **HARD RULE:** additive, newly-numbered migrations only — **never edit 0012 or
> 0093.** All steps are backward-compatible (`institution_id IS NULL` = today's
> global matrix), so nothing breaks on deploy; `runMigrations()` applies them on
> boot.

- **Phase 0 — now (no schema change): grant-by-matrix.** Document the 20 job-
  roles and seed them as global `built_in` templates in `role_permissions`
  (role = job-role key, `institution_id` implicitly the future default). Tenants
  are still assigned the 5 base enum roles; the platform console remains the
  editor. This delivers the *named roles* immediately with zero risk.
- **Phase 1 — per-tenant layer.** One additive migration adds
  `role_permissions.institution_id`, the tenant role catalogue (extend
  `rbac_roles` or add `tenant_roles`), `users.tenant_role` (relaxed CHECK), and
  indexes. Update the resolver cache to key by `(institution_id, role)`. Ship
  the tenant role manager UI. Enforce the primary-admin lockout guard.
- **Phase 2 — GA.** Per-tenant tuning + custom roles open to tenants; auditor/
  read-only and college HOD scoping validated; retire any lingering blanket
  `authorize("admin")` in favour of granular `requirePermission` (master §6
  rule 10) so teacher/accountant granularity is real.

**Sequencing:** this is master roadmap **PR-T2**, landing after **PR-T0**
(isolation hardening — because per-tenant grants presume correct per-tenant
isolation) and **PR-T1** (tenant Settings, the home the role manager links from).
Consistent with master §9's build order.
