# AI Copilot — Phase 1 Pilot Plan (+ T11.1 decision)

> PLANNING ONLY. The copilot (PR-T11, Deploy #110) is live in production but
> **dark**: `requireFeatureOptIn("aiCopilot")` is default-DENY, no tenant
> carries the flag, the VPS has no `OPENAI_API_KEY`, and `ai:copilot` is
> admin-only. **Do not enable globally — ever.** This plan governs the first
> and only enablement path.

## 1. Pilot scope — ONE tenant

- Ops-only (zero code): (1) set `OPENAI_API_KEY` on the VPS backend env;
  (2) set `settings.featureFlags.aiCopilot = true` for exactly one friendly
  pilot tenant via the existing settings write path. TTL cache (60s) applies —
  no restart needed. **Kill switch** = flip the flag back (or unset the key →
  clean 503); both proven in T11 tests/smoke.
- Duration: 2 weeks. Users: the pilot tenant's admins only (permission is
  admin-only by migration 0116).

## 2. Standing guardrails (already code-enforced; restated as pilot policy)

Read-only (allow-listed read retrievers only; no-mutation row-count proof in
CI) · per-user RBAC omission (`effectivePermissions` gate per retriever) ·
tenant isolation (institution-scoped services; two-tenant test) · every turn
audited (`ai.copilot.query`, masked prompt, retrievers used → tenant
`audit_logs`) + `ai_usage` row · drafts are placeholder-only text, never sent ·
safe refusals: flag 403, perm 403, provider 503, quota 429 · cost caps via env
(6/min, 50/day/user, 700 tokens).

## 3. Safe pilot use cases (the shipped 10)

Needs-attention today · attendance summary · attendance risk · fees summary ·
fee risk (manual-action suggestion only) · exams summary · health snapshot ·
failed tenant jobs · admin audit-event summary · Help/SOP answers citing T10
doc ids · parent-communication **draft** (placeholders).

## 4. What the AI must never do (unchanged, non-negotiable)

Mutate anything · send/enqueue email/SMS/push · approve/schedule/retry/export ·
cross a tenant boundary · exceed the caller's permissions · surface
secrets/tokens/passwords/payment/SMTP/storage credentials · fabricate (must
cite or say "no data").

## 5. Pilot metrics & weekly review

- Volume + cost: `ai_usage` count/user/day vs caps; token spend vs provider bill.
- Quality: sample 20 audited turns/week — citation correctness, refusal
  correctness (asked-to-act → refused + deep-link), hallucination count
  (target 0 uncited claims).
- Safety: zero cross-tenant content, zero mutation attempts in audit,
  zero secrets in masked prompts.
- UX: pilot-admin feedback survey (usefulness 1–5, top 3 asks).

**Exit criteria:** ≥80% turns rated useful, 0 safety incidents, cost within
budget → widen to 2–3 tenants (still flag-per-tenant) or hold. Any safety
incident → flag off immediately, incident note, fix before re-enable.

## 6. Phase 2 (future, separate approval) — draft-only deepening

Pre-filled composer handoff, weekly digest as a viewable report, per-role
starter packs. Still zero writes; same guardrails; new PR + approval.

## 7. Phase 3 (future, separate approval) — confirm-then-act

Copilot proposes → human reviews the exact payload → an **existing**
permissioned write endpoint executes; write-perm re-checked at execution;
idempotency + full audit. Never a copilot-authored write path.

## 8. T11.1 — legacy `/assistant` (tracked task #160)

Problem: the pre-T11 `/ai` assistant is tenant-scoped but **not per-user
permission-scoped** (any admin/teacher/accountant sees the same aggregates).
Options: **(a) Retire** — redirect `/assistant` → `/copilot` and 410 the old
endpoint after the pilot proves the replacement (cleanest; recommended);
(b) Harden — rebuild its snapshot on the copilot retriever layer (more work,
two surfaces forever). **Recommendation: (a)**, sequenced BEFORE the pilot so
attention lands on one correct surface. PR-T11.1 = redirect page + endpoint
deprecation + tests; no data loss (its Mongo history is per-user chat only —
export note in the PR).
