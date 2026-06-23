# GoCampus Documentation

> **The documentation landing page.** New to the project? Start with
> **[Team Onboarding](./TEAM_ONBOARDING.md)**. Need the canonical doc for an area?
> Check the **[Latest Document Register](./governance/LATEST_DOCUMENT_REGISTER.md)**.
>
> GoCampus (internally **SRE EDU OS** / `sreedo`) is a multi-tenant school &
> college ERP — Next.js web + Flutter mobile → Express/TypeScript API → PostgreSQL
> (+ optional MongoDB), deployed with Docker Compose + Nginx at `gocampusos.com`.

---

## 🚀 Start here

| I want to… | Go to |
|---|---|
| Get productive as a new joiner | [Team Onboarding](./TEAM_ONBOARDING.md) |
| Understand the product & scope | [Product overview (PRD)](./PRD.md) |
| Understand the architecture | [Architecture overview](./ARCHITECTURE.md) |
| Find the current doc for a topic | [Latest Document Register](./governance/LATEST_DOCUMENT_REGISTER.md) |
| Know how to name/version docs | [File Naming Standard](./governance/FILE_NAMING_STANDARD.md) |
| Ship a change correctly | [Release & Change Management](./governance/RELEASE_AND_CHANGE_MANAGEMENT.md) |

## 📚 Core references

| Topic | Document |
|---|---|
| Product requirements | [PRD.md](./PRD.md) |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Setup & local development | [Team Onboarding §4](./TEAM_ONBOARDING.md#4-run-it-locally) · root [README](../README.md) |
| Deployment guide | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Environment variables | both `.env.example` files · `backend/src/config/env.ts` · [DEPLOYMENT §3](./DEPLOYMENT.md) |
| API documentation | [API_REFERENCE.md](./API_REFERENCE.md) · live Swagger at `/api/docs` |
| Database / schema | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| Roles, RBAC & tenant isolation | [ROLES_AND_PERMISSIONS.md](./ROLES_AND_PERMISSIONS.md) · [super-admin module](./modules/super-admin-multi-tenancy-rbac-module.md) |
| Module workflows | [MODULE_WORKFLOWS.md](./MODULE_WORKFLOWS.md) |
| UI / screen inventory | [UI_PAGES.md](./UI_PAGES.md) |
| Testing | [E2E_TESTING.md](./E2E_TESTING.md) · [PERFORMANCE.md](./PERFORMANCE.md) |
| Backup & restore | [backup-restore module](./modules/backup-restore-module.md) · [DEPLOYMENT §8](./DEPLOYMENT.md) |
| Troubleshooting | each [module doc](./modules/) has a *Common troubleshooting* table |
| Developer handover & backlog | [DEVELOPER_HANDOVER.md](./DEVELOPER_HANDOVER.md) · [DEV_ROADMAP.md](./DEV_ROADMAP.md) |
| Planning suite index | [PLANNING_INDEX.md](./PLANNING_INDEX.md) |

## 🧩 Module documentation

One doc per feature area, each with the same 11 sections (purpose, roles, screens,
APIs, tables, RBAC, tenant isolation, workflows, tests, troubleshooting, future).

**Core academics & people**
- [Students / Admissions](./modules/students-module.md)
- [Staff / HR](./modules/staff-hr-module.md)
- [Academics](./modules/academics-module.md)
- [Attendance](./modules/attendance-module.md)
- [Exams & Report Cards](./modules/exams-report-cards-module.md)
- [Timetable](./modules/timetable-module.md)
- [College Mode](./modules/college-mode-module.md)

**Finance & operations**
- [Fees / Payments / Receipts](./modules/fees-payments-module.md)
- [Payroll](./modules/payroll-module.md)
- [Library](./modules/library-module.md)
- [Transport](./modules/transport-module.md)
- [Hostel](./modules/hostel-module.md)
- [Inventory](./modules/inventory-module.md)
- [Leave Management](./modules/leave-management-module.md)

**Engagement & records**
- [Communication / Notifications](./modules/communication-notifications-module.md)
- [Parent & Student Portal](./modules/parent-student-portal-module.md)
- [Homework / Assignments](./modules/homework-assignments-module.md)
- [Documents / File Uploads](./modules/documents-file-uploads-module.md)
- [Transfer Certificates](./modules/transfer-certificates-module.md)
- [Discipline Records](./modules/discipline-records-module.md)

**Intelligence & reporting**
- [AI Insights](./modules/ai-insights-module.md)
- [Reports Center](./modules/reports-center-module.md)
- [Custom Report Builder](./modules/custom-report-builder-module.md)

**Platform & operations**
- [Super Admin / Multi-Tenancy / RBAC](./modules/super-admin-multi-tenancy-rbac-module.md)
- [Backup / Restore](./modules/backup-restore-module.md)
- [Observability](./modules/observability-module.md)

## 🗺️ Pipeline diagrams

Mermaid diagrams (render on GitHub) in [`docs/diagrams/`](./diagrams/):

- [Overall system architecture](./diagrams/diagram_overall-system-architecture.md)
- [Deployment pipeline](./diagrams/diagram_deployment-pipeline.md)
- [Production go-live flow](./diagrams/diagram_production-go-live-flow.md)
- [Auth / RBAC / tenant flow](./diagrams/diagram_auth-rbac-tenant-flow.md)
- [Student admission pipeline](./diagrams/diagram_student-admission-pipeline.md)
- [Fee payment & receipt pipeline](./diagrams/diagram_fee-payment-receipt-pipeline.md)
- [Exam & report-card pipeline](./diagrams/diagram_exam-report-card-pipeline.md)
- [Parent / student portal flow](./diagrams/diagram_parent-student-portal-flow.md)
- [Homework / assignment flow](./diagrams/diagram_homework-assignment-flow.md)
- [Document upload / download flow](./diagrams/diagram_document-upload-download-flow.md)
- [Notification pipeline](./diagrams/diagram_notification-pipeline.md)
- [Backup / restore pipeline](./diagrams/diagram_backup-restore-pipeline.md)
- [AI insights pipeline](./diagrams/diagram_ai-insights-pipeline.md)
- [Reports center pipeline](./diagrams/diagram_reports-center-pipeline.md)
- [Mobile app ↔ API flow](./diagrams/diagram_mobile-app-api-flow.md)

## 🏛️ Governance & templates

- [File Naming Standard](./governance/FILE_NAMING_STANDARD.md)
- [Release & Change Management](./governance/RELEASE_AND_CHANGE_MANAGEMENT.md)
- [Latest Document Register](./governance/LATEST_DOCUMENT_REGISTER.md)
- [Handoff ZIP Manifest](./governance/HANDOFF_ZIP_MANIFEST.md)
- [Update Documentation Checklist (template)](./templates/update-documentation-checklist.md)

---

*Keep this index current: when you add a top-level doc, add a link here and a row
in the [register](./governance/LATEST_DOCUMENT_REGISTER.md). See the
[naming standard](./governance/FILE_NAMING_STANDARD.md).*
