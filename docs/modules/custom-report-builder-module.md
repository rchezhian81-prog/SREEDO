# Custom Report Builder Module

> **Status:** Implemented · **Backend:** `backend/src/modules/customreports` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md) · [Reports Center](./reports-center-module.md)

## 1. Purpose

A user-defined, ad-hoc report builder layered over the
[Reports Center](./reports-center-module.md) registry. A user picks a report
**source** (any Reports Center report key), previews it to discover columns, then
chooses columns + reusable filters + a sort order. The definition can be run and
exported (CSV/PDF) immediately (ad-hoc) or **saved** as a named, reusable report
that others can run.

Crucially the builder **never widens access**: running, previewing or exporting a
custom report re-checks the *underlying* source report's own permission, and
everything stays tenant-scoped. Saved custom reports are also what
[Scheduled Reports](./reports-center-module.md) point at.

## 2. User roles involved

| Role | Capability |
|------|-----------|
| `admin` | Full: create/run/edit/duplicate/delete + share; may edit/delete others' reports |
| `accountant` | Create/run/export/edit/delete own; **cannot share** (no `custom_reports:share`) |
| `teacher` | Read/run/export (per seeded grants) |
| `student`/`parent` | No access |
| `super_admin` | Bypasses permission checks |

In all cases the underlying source report's permission still applies (e.g. a fee
source needs `reports:fees:read`).

## 3. Main screens / pages

Web (`frontend/src/app/(dashboard)/report-builder/`):

| Page | Route |
|------|-------|
| Saved reports list | `/report-builder` |
| Create | `/report-builder/new` |
| View | `/report-builder/[id]` |
| Edit | `/report-builder/[id]/edit` |

## 4. Main backend APIs

Router — `backend/src/modules/customreports/customreports.routes.ts`
(`authenticate, requireTenant`):

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/custom-reports/sources` | Available report sources (Reports Center registry) | `custom_reports:read` |
| GET | `/custom-reports` | List saved reports (shared + mine) | `custom_reports:read` |
| POST | `/custom-reports` | Create a saved definition (sharing needs `custom_reports:share`) | `custom_reports:create` |
| POST | `/custom-reports/preview` | Run an ad-hoc report without saving | `custom_reports:run` |
| POST | `/custom-reports/export` | Export an ad-hoc report (CSV/PDF) | `custom_reports:export` |
| GET | `/custom-reports/{id}` | Get a saved definition | `custom_reports:read` |
| PATCH | `/custom-reports/{id}` | Edit (creator or admin) | `custom_reports:update` |
| DELETE | `/custom-reports/{id}` | Delete (creator or admin) | `custom_reports:delete` |
| POST | `/custom-reports/{id}/duplicate` | Duplicate as a private copy | `custom_reports:create` |
| GET | `/custom-reports/{id}/run` | Run a saved report -> `{ title, columns, rows }` | `custom_reports:run` (+ underlying) |
| GET | `/custom-reports/{id}/export` | Export a saved report (CSV/PDF) | `custom_reports:export` (+ underlying) |

## 5. Database tables / entities

- **`custom_reports`** (migration `0036_custom_reports.sql`): `id`,
  `institution_id` (NOT NULL, CASCADE), `name`, `report_key` (Reports Center
  registry key), `columns` (JSONB; selected column keys, `[]` = all), `filters`
  (JSONB), `sort` (JSONB; `{ key, dir }`), `group_by` (TEXT), `visibility`
  (`private`/`shared`, default `private`), `created_by` -> users (SET NULL),
  `created_at`/`updated_at` (with an `updated_at` trigger). Indexed on
  `(institution_id, created_at)` and `(institution_id, created_by)`.
- The module owns no data tables beyond definitions; report **rows** come from the
  underlying Reports Center SQL at run time.

## 6. Permissions / RBAC involved

Keys (seeded `0036`): `custom_reports:read|create|update|delete|run|export|share`.
Seeded grants: admin = all (incl. `share`); accountant = all except `share`;
teacher = read/run/export; student/parent = none. `super_admin` bypasses checks.
Independently, every run/preview/export enforces the *source* report's permission
via `assertUnderlyingPermission`.

## 7. Tenant isolation notes

- All queries filter by `institution_id`.
- **Visibility:** `private` reports are visible only to their creator (no
  existence leak — `loadAccessible` returns 404 for a non-creator); `shared`
  reports are visible to anyone with `custom_reports:read` in the tenant.
  Creating/updating to `shared` requires `custom_reports:share`.
- **Edit/delete** are restricted to the creator or an admin.
- **No access widening:** `runSaved`/`adhocRun`/`exportSaved` call
  `assertUnderlyingPermission(role, reportKey)` so a custom report can never
  expose data the caller couldn't already read in the Reports Center; the
  underlying SQL is itself tenant-scoped.

## 8. Key workflows

1. **Discover:** `GET /custom-reports/sources` lists report keys; `POST /preview`
   runs a source to reveal its columns.
2. **Ad-hoc:** choose columns + filters (date range, class/section, status,
   category, search, etc.) + sort, then `POST /preview` to view or `POST /export`
   to download CSV/PDF — without saving.
3. **Save:** `POST /custom-reports` persists the definition (name, source key,
   columns, filters, sort, visibility). `runDefinition` projects to the selected
   columns and applies the sort at run time.
4. **Reuse:** run (`GET /{id}/run`), export (`GET /{id}/export`), duplicate
   (`POST /{id}/duplicate` -> private copy), edit, delete.
5. **Schedule:** a saved report can be the target of a Scheduled Report (see the
   [Reports Center module](./reports-center-module.md)).

## 9. Test coverage summary

- `backend/tests/integration/customreports.int.test.ts` — create/edit/duplicate/
  delete; run with column projection; ad-hoc preview (run without saving); CSV +
  PDF export; shared vs private visibility (accountant cannot create shared);
  shared reports visible to others with read; enforcement of the underlying source
  report's permission; students/parents blocked; cross-institution denial.
- Run via `npm run test:integration`.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| 403 running/exporting a saved report | Caller lacks the *underlying* source report's permission | Grant the source's key (e.g. `reports:fees:read`) |
| 403 "do not have permission to share reports" | Setting `visibility: shared` without `custom_reports:share` | Use an admin, or keep it private |
| 404 on a custom report id | It is `private` and owned by someone else (no existence leak) | Use your own/shared report, or have an admin access it |
| Edit/delete 403 | Not the creator and not an admin | Only the creator or an admin may modify |
| Selected columns ignored | Chosen column keys don't match the source's columns | Preview first to get valid column keys |
| Empty rows | Filters too narrow or a Phase B/D source with no data in this tenant | Adjust filters; confirm the source module has data |

## 11. Future enhancement notes

- `group_by` is stored on the definition but aggregation is not yet applied at run
  time (rows are projected + sorted only); grouping/aggregation is a natural
  follow-up.
- Saved exports are generated on demand and not persisted to `documents`;
  artifact retention could be added (also benefits Scheduled Reports).
