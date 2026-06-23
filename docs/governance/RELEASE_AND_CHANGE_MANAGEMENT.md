# Release & Change Management

> **Status:** Active · **Owner:** Engineering · **Last updated:** 2026-06-23
>
> Governs how changes flow from a branch to production and how the documentation
> stays in sync. See also: [File Naming Standard](./FILE_NAMING_STANDARD.md) ·
> [Latest Document Register](./LATEST_DOCUMENT_REGISTER.md) ·
> [Update checklist](../templates/update-documentation-checklist.md) ·
> [Deployment runbook](../DEPLOYMENT.md).

---

## 1. Lifecycle at a glance

```
branch  →  code + docs  →  PR (checklist + green CI)  →  review  →  merge to main
       →  main CI green  →  deploy to VPS  →  verify  →  release note + register update
```

Two hard rules:
1. **Never commit straight to `main`.** Every change goes through a branch + PR.
2. **Docs ship with code.** A change isn't "done" until its module doc, diagrams,
   register row, and release/rollback notes are updated (use the
   [update checklist](../templates/update-documentation-checklist.md)).

---

## 2. Naming upgrade / update / release files

Follow the [File Naming Standard](./FILE_NAMING_STANDARD.md):

| Kind | Pattern | Location |
|---|---|---|
| Release / readiness note | `YYYY-MM-DD_scope_change-type_vX.Y.md` | `docs/releases/` |
| Upgrade note | `upgrade_<version-or-date>_<short-scope>.md` | `docs/upgrades/` |
| Decision record | `ADR-NNNN-short-title.md` | `docs/adr/` |
| Diagram | `diagram_<flow>-<type>.md` | `docs/diagrams/` |
| Module doc | `<module-name>-module.md` | `docs/modules/` |

Examples: `2026-06-22_gocampus_rebrand_v1.0.md`, `upgrade_2026-06-22_gocampus-domain.md`.

---

## 3. Creating a branch

```bash
git fetch origin main
git switch -c <type>/<short-topic> origin/main      # branch off the latest main
```

- Branch from **`origin/main`**, not from another feature branch.
- Use a clear prefix: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`.
  Examples: `feat/fee-receipt-pdf`, `docs/governance-handoff`, `fix/attendance-tz`.
- Keep one logical change per branch; small PRs review faster.

## 4. Opening a pull request

1. Push: `git push -u origin <branch>`.
2. Open a PR into `main`.
3. Paste the [Update Documentation Checklist](../templates/update-documentation-checklist.md)
   into the description and fill it in.
4. Wait for CI; do not request review until it's green.

### Required PR checklist (summary)
- [ ] Scope is focused; commits are descriptive.
- [ ] Backend `npm run typecheck` + `npm test` pass; new endpoints have `@openapi`
      blocks and zod validation; SQL is parameterized.
- [ ] Frontend `npm run build` passes; HTTP goes through `src/lib/api.ts`.
- [ ] New env vars added to `src/config/env.ts` **and** both `.env.example` files.
- [ ] New migration added (never edited an applied one), if schema changed.
- [ ] Tenant isolation preserved (`institution_id` scoping) for new queries.
- [ ] RBAC permission keys added/seeded if new actions were introduced.
- [ ] Docs, diagrams, register, and release/rollback notes updated.
- [ ] **No secrets** committed (only `*.env.example`).

---

## 5. CI requirements

CI (`.github/workflows/ci.yml`) must be **green before merge**. Jobs:

| Job | Runs |
|---|---|
| **Backend** | `npm ci` → `typecheck` → `test` (unit) → `test:integration` (Postgres service) → `build` → `perf:validate` |
| **Frontend** | `npm ci` → `typecheck` → `test` → `build` → `e2e:validate` |
| **Mobile** | `flutter pub get` → `flutter analyze --no-fatal-infos` |
| **Docker images** | builds backend + frontend images — **on push to `main` only** (skipped on PRs by design) |

Because the Docker job only runs on push, a PR shows three green checks; the full
four (incl. image build) run after merge on `main`. Treat a red `main` build as a
release blocker.

---

## 6. Documentation update rules

Whenever code changes, in the **same PR**:
1. Edit the **canonical** doc in place — never fork a "v2" copy
   (see [naming standard §8](./FILE_NAMING_STANDARD.md#8-anti-duplication--changelog-rules)).
2. Update the relevant **module doc(s)** so all 11 sections stay accurate.
3. Update or add the relevant **diagram(s)** if a flow changed.
4. Update the **[Latest Document Register](./LATEST_DOCUMENT_REGISTER.md)**.
5. Add a **release/upgrade note** (§2) for anything user- or ops-visible.

---

## 7. Versioning rules

- Use `vMAJOR.MINOR` for documentation/release notes.
- **MINOR** (`v1.0 → v1.1`): additive or backward-compatible (new field, new doc,
  new endpoint that doesn't break callers).
- **MAJOR** (`v1.x → v2.0`): breaking changes (removed/renamed endpoint, breaking
  schema change, auth/permission model change, domain/brand change).
- Application schema changes are delivered via **forward-only numbered migrations**
  in `backend/src/db/migrations/`; the "version" of the DB is the latest applied
  migration number.

---

## 8. Release note rules

A release note (`docs/releases/YYYY-MM-DD_scope_change-type_vX.Y.md`) should state:
- **What changed** (features/fixes) and **why**.
- **Modules / APIs / DB** affected.
- **Migration(s)** included and whether they're destructive.
- **New/changed env vars** and required ops actions.
- **Verification steps** (how we confirmed it works in production).
- A link to the PR(s) and the rollback note.

## 9. Rollback note rules

Every release that touches code or schema must document how to undo it:
- **Code rollback:** redeploy the previous commit/tag
  (`git checkout <prev-tag> && docker compose up -d --build`).
- **Schema:** migrations are forward-only — if a deploy with a migration goes bad,
  roll back the code **and restore from a backup** taken before the upgrade
  (see [backup/restore runbook](../modules/backup-restore-module.md) and
  [DEPLOYMENT.md §8](../DEPLOYMENT.md)).
- Always **take a backup before a risky upgrade**; keep the `pgdata` volume across
  updates (it persists by default).

---

## 10. Marking deprecated docs

Don't delete silently. Add a banner at the top of the old file and point to the
replacement, then catalogue it in the register:

```md
> ⚠️ **Deprecated (YYYY-MM-DD).** Superseded by [replacement.md](./replacement.md).
> Kept for history; do not update.
```

Move clearly-archived files to `docs/archive/`. ADRs are deprecated by writing a
new ADR that **supersedes** them (set `Status: Superseded by ADR-NNNN`).

---

## 11. Updating the Latest Document Register

The [LATEST_DOCUMENT_REGISTER.md](./LATEST_DOCUMENT_REGISTER.md) is the single
table that tells the team which document is current for each area. On every doc
change:
1. Find the row for the area (or add one).
2. Update **Latest document name**, **File path**, and **Last updated date**.
3. If you deprecated a doc, point the row at the replacement.
4. Commit the register change in the **same PR** as the doc change.

> Tip: the [handoff ZIP](./HANDOFF_ZIP_MANIFEST.md) is regenerated from the current
> docs via `scripts/create-handoff-zip.sh`; keeping the register accurate keeps the
> handoff package accurate.
