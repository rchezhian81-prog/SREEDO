# Planning Index — SRE EDU OS

This is the entry point to the planning documentation for the SRE EDU OS School /
College ERP. It maps the **10 planning deliverables + PRD** requested in the
project brief to the documents that contain them.

> **Important context:** SRE EDU OS already has a **working, verified MVP**
> (auth, RBAC, dashboard, students, teachers, academics, attendance, fees, exams,
> announcements, AI assistant) across backend (Express/TS/PostgreSQL), frontend
> (Next.js), and mobile (Flutter), with Docker, Nginx, and CI. These planning
> docs therefore describe the **full target ERP** and mark, throughout, what is
> ✅ built / 🟡 partial / ⬜ planned — so they serve as both the specification
> and the roadmap from today's MVP to the complete 20-module system.

## Requested deliverables → documents

| # | Requested artifact | Document |
|---|--------------------|----------|
| — | **Product Requirement Document (PRD)** | [`PRD.md`](./PRD.md) |
| 1 | System architecture | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| 2 | Database schema | [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) |
| 3 | API list | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| 4 | User roles & permissions matrix | [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md) |
| 5 | Module-wise workflow | [`MODULE_WORKFLOWS.md`](./MODULE_WORKFLOWS.md) |
| 6 | Folder structure | [`ARCHITECTURE.md` §10](./ARCHITECTURE.md) |
| 7 | UI page list | [`UI_PAGES.md`](./UI_PAGES.md) |
| 8 | Development phases | [`DEV_ROADMAP.md` Part 1](./DEV_ROADMAP.md) |
| 9 | Testing plan | [`DEV_ROADMAP.md` Part 2](./DEV_ROADMAP.md) |
| 10 | Deployment plan (Hostinger/Docker/Nginx/SSL/GitHub Actions) | [`DEV_ROADMAP.md` Part 3](./DEV_ROADMAP.md) |

## Also in this folder

| Document | Purpose |
|----------|---------|
| [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md) | How the built system works; conventions; **backlog (§8)** |
| `ROADMAP.html` | Non-technical, click-by-click run + deploy walkthrough |

## How to use these docs

- **Product owner:** read [`PRD.md`](./PRD.md) (vision, modules, status) and
  [`DEV_ROADMAP.md`](./DEV_ROADMAP.md) (what ships when).
- **New developer:** read [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md) then
  [`ARCHITECTURE.md`](./ARCHITECTURE.md), and use
  [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) + [`API_REFERENCE.md`](./API_REFERENCE.md)
  as references while coding.
- **Building a feature:** check its workflow in
  [`MODULE_WORKFLOWS.md`](./MODULE_WORKFLOWS.md), its access rules in
  [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md), and its screens in
  [`UI_PAGES.md`](./UI_PAGES.md).

## Build order (summary)

`Phase 0 MVP ✅` → **`Phase A` foundation hardening + multi-tenancy + Super Admin
+ permissions + MVP UI gaps** → `Phase B` college mode + timetables → `Phase C`
portals + homework + communication + uploads + AI+ → `Phase D` library/transport/
hostel/inventory/payroll + reports → `Phase E` scale & polish. Full detail in
[`DEV_ROADMAP.md`](./DEV_ROADMAP.md).
