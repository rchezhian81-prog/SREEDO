# File Naming Standard

> **Status:** Active · **Owner:** Engineering / Docs governance · **Last updated:** 2026-06-23
>
> Part of the [documentation governance](./) suite. See also:
> [Release & change management](./RELEASE_AND_CHANGE_MANAGEMENT.md) ·
> [Latest document register](./LATEST_DOCUMENT_REGISTER.md) ·
> [Docs index](../README.md)

This standard keeps the repository's documentation **predictable, searchable, and
free of duplicates** so any future developer or team member can find the one
correct file without guessing. It applies to everything under `docs/` and to any
release/upgrade notes, diagrams, and decision records added anywhere in the repo.

> **Source code is out of scope.** Do **not** rename source/code files to satisfy
> this standard — existing backend module folders (`backend/src/modules/<name>/`),
> React pages, and Flutter files keep their current conventions. This document
> governs **documentation artifacts only**.

---

## 1. Core principles

1. **One source of truth.** Each topic has exactly **one** living document. Update
   it in place; never create a parallel "v2" copy alongside the original.
2. **Lowercase, hyphenated, descriptive.** Prefer `kebab-case`; avoid spaces,
   underscores (except where a format below requires them), capitals, and
   abbreviations a newcomer wouldn't recognize.
3. **Dates are ISO 8601.** Always `YYYY-MM-DD` (e.g. `2026-06-23`) so files sort
   chronologically.
4. **Versions are `vMAJOR.MINOR`.** e.g. `v1.0`, `v1.1`, `v2.0`.
5. **Names describe content, not status.** A file is never `final`, `latest`,
   `new`, `updated`, or `copy` — those describe a moment in time, not a topic.
6. **Every change is logged.** Every upgrade/update adds a register + changelog
   entry (see §8 and the [release guide](./RELEASE_AND_CHANGE_MANAGEMENT.md)).

---

## 2. Quick reference

| Artifact type | Pattern | Example |
|---|---|---|
| Documentation page | `kebab-case.md` | `deployment-guide.md` |
| Module document | `<module-name>-module.md` | `fee-management-module.md` |
| Release / update note | `YYYY-MM-DD_scope_change-type_vX.Y.md` | `2026-06-22_deployment_readiness_v1.0.md` |
| Diagram | `diagram_<module-or-flow>-<type>.md` | `diagram_fee-payment-pipeline.md` |
| Upgrade note | `upgrade_<version-or-date>_<short-scope>.md` | `upgrade_2026-06-22_gocampus-domain.md` |
| Decision record (ADR) | `ADR-NNNN-short-title.md` | `ADR-0001-use-postgresql-primary.md` |
| Template | `<thing>-template.md` or `<thing>-checklist.md` | `update-documentation-checklist.md` |

---

## 3. Documentation files

Use **lowercase kebab-case** with a `.md` extension. The name should read like the
title of the page.

✅ Good:
- `deployment-guide.md`
- `fee-management-module.md`
- `student-portal-workflow.md`
- `backup-restore-runbook.md`

❌ Avoid:
- `Deployment Guide.md` (spaces, capitals)
- `feeMgmt.md` (camelCase, abbreviation)
- `student_portal.md` (underscores — reserve those for the dated/prefixed formats below)

> **Existing top-level docs** (e.g. `DEPLOYMENT.md`, `ARCHITECTURE.md`,
> `PRD.md`) predate this standard and use `SCREAMING_SNAKE_CASE`. They are the
> canonical references and are **not** being renamed (that would break many inbound
> links). New documentation should follow the kebab-case rule; the historical
> uppercase files remain valid and are catalogued in the
> [latest document register](./LATEST_DOCUMENT_REGISTER.md).

---

## 4. Release / update documents

For point-in-time records of a release, readiness review, or coordinated update,
use a **date + scope + change-type + version** name so they sort by date and are
self-describing.

```
YYYY-MM-DD_scope_change-type_vX.Y.md
```

- `scope` — the area touched (`deployment`, `fee-module`, `gocampus`, `rbac`…).
- `change-type` — `readiness`, `rebrand`, `update`, `hotfix`, `migration`…
- `vX.Y` — the version this note documents.

✅ Examples:
- `2026-06-22_deployment_readiness_v1.0.md`
- `2026-06-22_gocampus_rebrand_v1.0.md`
- `2026-06-22_fee-module_update_v1.1.md`

Store these under `docs/releases/` (create it when the first one is added).

---

## 5. Diagrams

Diagrams are Markdown files containing a **Mermaid** diagram (so they render on
GitHub and stay diffable). Prefix every diagram file with `diagram_`, then a
kebab-case flow/module name, then a `-<type>` suffix.

```
diagram_<module-or-flow>-<type>.md
```

`<type>` is one of: `pipeline`, `flow`, `architecture`, `sequence`, `erd`.

✅ Examples (these live in [`docs/diagrams/`](../diagrams/)):
- `diagram_student-admission-pipeline.md`
- `diagram_fee-payment-receipt-pipeline.md`
- `diagram_parent-student-portal-flow.md`
- `diagram_deployment-pipeline.md`

Each diagram file must include: a short **Overview**, the **Mermaid** block, the
**key files involved**, the **key APIs involved**, and **operational notes**.

---

## 6. Upgrade notes

Short, focused notes describing how to perform (or what changed in) a specific
upgrade — domain moves, dependency bumps, schema upgrades, feature rollouts.

```
upgrade_<version-or-date>_<short-scope>.md
```

✅ Examples:
- `upgrade_2026-06-22_gocampus-domain.md`
- `upgrade_v1.1_fee-receipts.md`

Store these under `docs/upgrades/` (create it when the first one is added). Every
upgrade note must also add a [register](./LATEST_DOCUMENT_REGISTER.md) row and a
changelog entry (§8).

---

## 7. Decision records (ADRs)

Architecture Decision Records capture **why** a significant choice was made. Use
the standard ADR format: a zero-padded sequential number and a short, kebab-case
title.

```
ADR-NNNN-short-title.md
```

✅ Examples:
- `ADR-0001-use-postgresql-primary.md`
- `ADR-0002-defer-read-replicas.md`
- `ADR-0003-clean-production-seed-policy.md`

Store ADRs under `docs/adr/` (create it when the first ADR is added). Number
strictly increasing; never reuse or renumber. To reverse a decision, add a new ADR
that **supersedes** the old one and mark the old one `Status: Superseded by ADR-NNNN`.

---

## 8. Anti-duplication & changelog rules

### One source of truth
- Before creating a file, **search `docs/` first** — if the topic exists, edit it.
- Never keep two files covering the same topic. If you must stage a rewrite, do it
  on a branch, not as a second file in `main`.

### Banned name patterns
These describe a moment, not a topic, and rot immediately. **Never** use:

| Banned | Use instead |
|---|---|
| `final.md`, `final-final.doc` | the topic name, e.g. `deployment-guide.md` |
| `new-update.md`, `update2.md` | a dated release note, `2026-06-22_scope_update_v1.1.md` |
| `latest.md` | the canonical doc + the [register](./LATEST_DOCUMENT_REGISTER.md) |
| `copy-of-...md`, `...-v2.md` (as a sibling) | edit the original; version via git history |
| `temp.md`, `notes.md`, `misc.md` | a descriptive, scoped name |

### Changelog / register on every change
For **every** upgrade or update:
1. Add or update the canonical document.
2. Update the **[Latest Document Register](./LATEST_DOCUMENT_REGISTER.md)** row
   (file path + last-updated date).
3. Add a release/upgrade note (§4 / §6) **or** a changelog entry, per the
   [release & change management guide](./RELEASE_AND_CHANGE_MANAGEMENT.md).
4. If a diagram or module doc is affected, update it too (use the
   [update checklist](../templates/update-documentation-checklist.md)).

### Deprecating a document
Don't silently delete. Add a banner to the top:

```md
> ⚠️ **Deprecated (2026-06-23).** Superseded by [new-doc.md](./new-doc.md).
> Kept for historical reference; do not update.
```

Move clearly-archived docs under `docs/archive/` and note them in the register.

---

## 9. Folder layout (target)

```
docs/
├── README.md                      # documentation landing page / index
├── TEAM_ONBOARDING.md             # new-joiner entry point
├── governance/                    # this standard + change management + registers
├── modules/                       # one <module-name>-module.md per module
├── diagrams/                      # diagram_<flow>-<type>.md (Mermaid)
├── templates/                     # checklists & doc templates
├── releases/    (as needed)       # YYYY-MM-DD_scope_change-type_vX.Y.md
├── upgrades/    (as needed)       # upgrade_<ver-or-date>_<scope>.md
├── adr/         (as needed)       # ADR-NNNN-short-title.md
└── archive/     (as needed)       # deprecated docs, clearly marked
```

Adhering to this layout means a newcomer can always answer *"where does this file
go, and what do I name it?"* in seconds.
