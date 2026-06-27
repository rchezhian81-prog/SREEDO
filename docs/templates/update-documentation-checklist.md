# Update Documentation Checklist (Template)

> **How to use:** Copy this checklist into your pull-request description (or a
> release note) whenever you change the system, and tick every box. It guarantees
> the docs, diagrams, register, and release/rollback notes stay in sync with the
> code. See the [Release & Change Management guide](../governance/RELEASE_AND_CHANGE_MANAGEMENT.md)
> and the [File Naming Standard](../governance/FILE_NAMING_STANDARD.md).

---

**Change title:** _<short description>_
**Date:** _YYYY-MM-DD_
**Author / owner:** _<name / team>_
**Version:** _vX.Y_
**Branch / PR:** _<branch name / #PR>_

---

## Impact assessment

- [ ] **Module(s) affected** — list every module touched: _______________________
- [ ] **Files changed** — summarize key files / directories: ____________________
- [ ] **Database / migration impact** — new migration added? (never edit an applied
      migration). Migration file(s): _________________  · _None_ ☐
- [ ] **API impact** — endpoints added/changed/removed? `@openapi` blocks updated?
      List: _________________  · _None_ ☐
- [ ] **UI impact** — web pages and/or mobile screens changed: __________________
      · _None_ ☐
- [ ] **RBAC impact** — new/changed permission keys or role assignments? List:
      _________________  · _None_ ☐
- [ ] **Tenant isolation impact** — any new table/query that must be scoped by
      `institution_id`? Confirm scoping added: ☐ N/A ☐ Verified
- [ ] **Test impact** — unit / integration / e2e / mobile analyze updated and
      passing? Notes: _________________

## Operational impact

- [ ] **Deployment impact** — new env vars (added to `src/config/env.ts` **and**
      both `.env.example` files)? compose/nginx changes? steps for the VPS:
      _________________  · _None_ ☐
- [ ] **Rollback note** — how to revert safely (code + data). For schema changes,
      reference the backup/restore runbook. Note: _________________

## Documentation sync

- [ ] **Documentation updated** — the canonical doc(s) edited in place (no
      duplicate files; naming standard followed).
- [ ] **Module doc updated** — `docs/modules/<module-name>-module.md` reflects the
      change (all 11 sections still accurate).
- [ ] **Diagram updated** — affected `docs/diagrams/diagram_*.md` updated (or new
      diagram added) if a flow changed.
- [ ] **Latest Document Register updated** — row(s) in
      `docs/governance/LATEST_DOCUMENT_REGISTER.md` (path + last-updated date).
- [ ] **Release note added** — dated note under `docs/releases/` per the naming
      standard, **or** changelog entry, if this is a release/upgrade.
- [ ] **Docs index checked** — `docs/README.md` links still resolve; add a link if
      a new top-level doc was created.

## Sign-off

- [ ] CI is green (backend typecheck+test, frontend build, mobile analyze).
- [ ] No secrets committed (only `*.env.example` templates).
- [ ] Reviewer approved.
