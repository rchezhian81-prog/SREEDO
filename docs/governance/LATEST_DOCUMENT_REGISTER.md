# Latest Document Register

> **Status:** Active · **Owner:** Engineering / Docs governance · **Last updated:** 2026-06-23
>
> The **single source of truth for which document is current** for each area. When
> you add or update a doc, update its row here in the same PR (see
> [Release & Change Management §11](./RELEASE_AND_CHANGE_MANAGEMENT.md#11-updating-the-latest-document-register)).
> Naming follows the [File Naming Standard](./FILE_NAMING_STANDARD.md).

| Area | Latest document | File path | Owner / team | Last updated | Purpose | When to update |
|---|---|---|---|---|---|---|
| Documentation index | GoCampus Documentation | `docs/README.md` | Engineering | 2026-06-23 | Landing page linking every doc | When any top-level doc is added/removed |
| Team onboarding | Team Onboarding | `docs/TEAM_ONBOARDING.md` | Engineering | 2026-06-23 | New-joiner guided tour | When setup, stack, or process changes |
| Product requirements | PRD | `docs/PRD.md` | Product | 2026-06-23 | Vision, modules, scope, success metrics | When product scope/roadmap changes |
| Architecture | Architecture overview | `docs/ARCHITECTURE.md` | Engineering | 2026-06-23 | System design, stack, data flow, security | When architecture/stack changes |
| Database / schema | Database schema | `docs/DATABASE_SCHEMA.md` | Backend | 2026-06-23 | Tables, columns, indexes, constraints | When a migration changes the schema |
| API | API reference | `docs/API_REFERENCE.md` | Backend | 2026-06-23 | Endpoint catalogue (mirror of Swagger) | When endpoints are added/changed |
| Roles / RBAC / tenancy | Roles & permissions | `docs/ROLES_AND_PERMISSIONS.md` | Backend | 2026-06-23 | Role → permission matrix, isolation model | When permissions/roles/tenancy change |
| Module workflows | Module workflows | `docs/MODULE_WORKFLOWS.md` | Engineering | 2026-06-23 | Step-by-step workflows per module | When a module workflow changes |
| UI / screens | UI pages | `docs/UI_PAGES.md` | Frontend | 2026-06-23 | Web + mobile screen inventory | When pages/screens are added/changed |
| Modules (index) | Module docs | `docs/modules/` (26 files) | Engineering | 2026-06-23 | One `<name>-module.md` per feature area | When a module's behavior changes |
| Diagrams (index) | Pipeline diagrams | `docs/diagrams/` (15 files) | Engineering | 2026-06-23 | Mermaid flow/pipeline/architecture diagrams | When a flow changes |
| Deployment | Deployment runbook | `docs/DEPLOYMENT.md` | DevOps | 2026-06-23 | VPS + Docker + TLS go-live runbook | When deploy steps/infra change |
| Environment variables | env templates + config | `.env.example`, `.env.production.example`, `backend/src/config/env.ts` | Backend | 2026-06-23 | Canonical list of env vars | When an env var is added/removed |
| Testing | E2E testing | `docs/E2E_TESTING.md` | QA / Engineering | 2026-06-23 | Playwright e2e strategy | When test strategy changes |
| Performance | Performance | `docs/PERFORMANCE.md` | Engineering | 2026-06-23 | k6 perf suite & thresholds | When perf targets/tests change |
| Backup / restore | Backup & restore module | `docs/modules/backup-restore-module.md` | DevOps | 2026-06-23 | Backup schedule, restore drill | When backup/restore behavior changes |
| Observability | Observability module | `docs/modules/observability-module.md` | DevOps | 2026-06-23 | Health probes, metrics | When probes/metrics change |
| Security / platform | Super-admin / RBAC module | `docs/modules/super-admin-multi-tenancy-rbac-module.md` | Backend | 2026-06-23 | Tenancy, RBAC, platform console | When platform/security model changes |
| Release notes | (none yet) | `docs/releases/` (create on first) | Release manager | 2026-06-23 | Dated release/readiness notes | On each release |
| Upgrade notes | (none yet) | `docs/upgrades/` (create on first) | Engineering | 2026-06-23 | Targeted upgrade instructions | On each upgrade |
| Decision records | (none yet) | `docs/adr/` (create on first) | Engineering | 2026-06-23 | ADRs for significant decisions | When a significant decision is made |
| Governance — naming | File Naming Standard | `docs/governance/FILE_NAMING_STANDARD.md` | Docs governance | 2026-06-23 | Naming rules for all doc artifacts | When naming rules change |
| Governance — process | Release & Change Management | `docs/governance/RELEASE_AND_CHANGE_MANAGEMENT.md` | Engineering | 2026-06-23 | Branch → PR → release process | When the process changes |
| Governance — handoff | Handoff ZIP Manifest | `docs/governance/HANDOFF_ZIP_MANIFEST.md` | Engineering | 2026-06-23 | Contents of the team handoff package | When the handoff contents change |
| Templates | Update Documentation Checklist | `docs/templates/update-documentation-checklist.md` | Engineering | 2026-06-23 | PR-time docs-sync checklist | When the checklist changes |

---

## Module documents (detail)

All under `docs/modules/`, each `<module-name>-module.md`, owner **Engineering**,
last updated **2026-06-23**. Update a row's source doc whenever that module's APIs,
schema, permissions, or workflows change.

| Module | File |
|---|---|
| Students / Admissions | `students-module.md` |
| Staff / HR | `staff-hr-module.md` |
| Academics | `academics-module.md` |
| Attendance | `attendance-module.md` |
| Exams & Report Cards | `exams-report-cards-module.md` |
| Timetable | `timetable-module.md` |
| Fees / Payments / Receipts | `fees-payments-module.md` |
| Payroll | `payroll-module.md` |
| Library | `library-module.md` |
| Transport | `transport-module.md` |
| Hostel | `hostel-module.md` |
| Inventory | `inventory-module.md` |
| Leave Management | `leave-management-module.md` |
| Communication / Notifications | `communication-notifications-module.md` |
| Parent & Student Portal | `parent-student-portal-module.md` |
| Homework / Assignments | `homework-assignments-module.md` |
| Documents / File Uploads | `documents-file-uploads-module.md` |
| Transfer Certificates | `transfer-certificates-module.md` |
| Discipline Records | `discipline-records-module.md` |
| AI Insights | `ai-insights-module.md` |
| Reports Center | `reports-center-module.md` |
| Custom Report Builder | `custom-report-builder-module.md` |
| Super Admin / Multi-Tenancy / RBAC | `super-admin-multi-tenancy-rbac-module.md` |
| Backup / Restore | `backup-restore-module.md` |
| Observability | `observability-module.md` |
| College Mode | `college-mode-module.md` |
