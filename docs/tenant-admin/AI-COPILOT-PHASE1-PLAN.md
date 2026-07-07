# GoCampus AI Copilot — Phase 1: Read-only Assistant

> **Status: PLANNING ONLY.** No code, no migrations, no deployment is proposed by
> this document. It is a decision-grade design for a **read-only, guardrailed**
> Tenant-Admin copilot that reuses GoCampusOS's existing AI layer, RBAC, tenant
> isolation, masking, audit, and optional-dependency patterns. Companion to
> `TENANT-ADMIN-MASTER-ROADMAP.md` (canonical); this is the doc that row 21 of the
> master's companion table and the wrap-up layer entry ("**AI Copilot Phase 1 🔭 —
> read-only assistant** … P2 / Future") point to.
>
> **Verdict / placement:** 🔭 Future · **Priority P2** · **last in the build order**
> (`PR-T5+`, after Tenant Help/SOP). **Depends on** `PR-T0` (isolation hardening —
> so every retrieval inherits validated in-tenant FK + `institution_id` scoping),
> `PR-T2` (Tenant RBAC v2 — finer per-user permission sets the copilot inherits),
> and the tenant-facing **Help/SOP surface** (master §3 module #30) for use case 10.

---

## 0. TL;DR (the one-paragraph decision)

Ship a **read-only assistant** that answers a tenant admin's operational questions
by **calling the same permissioned service functions the UI already calls** —
never raw SQL, never a new privileged data path. It **reads only what the calling
user's permissions already allow** (enforced server-side, per user), **every
retrieval is scoped to `institution_id`**, **every prompt + response is audited**
(`ai.copilot.query`, masked), **secrets/PII are masked**, and the whole surface is
**off by default** behind a feature flag + `OPENAI_API_KEY` and **degrades
gracefully** (503) when unconfigured. It **never mutates, sends, enqueues,
schedules, approves, or crosses a tenant boundary.** Its most "active" output is a
**draft** or a **summary with a deep-link to the existing manual action** — exactly
the posture the current `/ai-insights` already takes ("Send fee reminders via
Communication (manual trigger)", `aiinsights.service.ts:182`).

This is **partly a hardening** of what exists, not purely additive — see §2.

---

## 1. What already exists (reuse, don't rebuild)

Evidence from the live code sweep (2026-07-07). The AI layer is already built and
already leans read-only; Phase 1 composes and tightens it.

| Asset | Where | What it gives Phase 1 |
|-------|-------|-----------------------|
| **`/ai` assistant** | `modules/ai/ai.routes.ts`, `ai.service.ts` | GPT chat over a **tenant-scoped snapshot** (`schoolContext()`, every figure `WHERE institution_id = $1`); Mongo `ai_conversations` history scoped by `userId`; **503 when `OPENAI_API_KEY` unset** (`ApiError.serviceUnavailable`, `ai.service.ts:69`). Guard: `authenticate, authorize("admin","teacher","accountant"), requireTenant`. |
| **`/ai-insights`** | `modules/aiinsights/*` | **Deterministic KPIs from tenant-scoped SQL** (`METRIC_SQL`, all `institution_id`-filtered) + **optional** OpenAI `narrative()` that returns `null` when unconfigured/on error; `aiAvailable()`; `logUsage()` → Mongo `ai_usage`. Behind `requireFeature("aiInsights")` + `ai:read/summarize/risk_alerts/document_search/workflow_suggestions`. Narratives are already instructed **"use only the data given; never invent numbers or names"** (`aiinsights.service.ts:434`). |
| **Feature flags** | `middleware/feature-flag.ts` | Per-tenant `settings.featureFlags[key]`, 60s TTL cache, `super_admin` bypass, `invalidateFeatureFlagCache()` on settings write. **Note: `requireFeature` is DEFAULT-ALLOW** — see the §7 design decision (Phase 1 needs opt-in). |
| **RBAC** | `middleware/permissions.ts` | `requirePermission("module:action")`; `effectivePermissions(user)` / `userHasPermission(user,key)` resolve the caller's **effective keys** — the exact primitive for per-user enforcement inside retrieval. |
| **Masking** | `modules/platform/audit.service.ts` | `maskSecrets()` (deep-clones, masks secret-named keys / secret-shaped values; passes `Date` through) and `maskFreeText()` (masks prefixed secret tokens in prose). `scanForSecrets()` (help.service) for a build-time no-secret test. |
| **Audit** | tenant: `middleware/audit.ts` → Mongo `audit_logs`; viewer `modules/activity` (own-tenant forced, degrades `{available:false}`). platform: `platform_audit_log` + `recordAudit(actor,{action,detail})` (help/jobs/backups). | Where `ai.copilot.query` lands. |
| **Help/SOP corpus** | `modules/help/*` (Super Admin Q) | **Read-only, curated-in-code** `helpArticles/sops/checklists/limitations/playbooks/onboarding`; `search()` across all types; build-time secret scan. **Today platform-only** (`help:read` not granted to tenant roles → 403, master §3 #30) — use case 10 rides the planned tenant Help/SOP surface. |
| **Rate limiting** | `middleware/rate-limit.ts` | `express-rate-limit`; `tenantRateLimiter` **keyed by institution** (`inst:<id>`) so one tenant can't starve another; env `RATE_LIMIT_*` / `TENANT_RATE_LIMIT_MAX` (default 600). In-memory today (Redis for multi-instance). |
| **Jobs (tenant-scoped)** | `modules/jobs/*` | `listJobs(scope, {status})` where `scope = super_admin ? null : institutionId`; `jobs:read`. Source for use case 6 (**tenant** job failures — *not* platform `observability`, which is Super Admin, out of scope). |
| **Optional deps** | `config/env.ts` (`openaiApiKey`, `openaiModel="gpt-4o"`), `db/mongo.ts` | OpenAI + Mongo are optional and already degrade — Phase 1 keeps that contract. |

---

## 2. Honest gap: Phase 1 is partly a hardening

The current `/ai` assistant's snapshot (`schoolContext()`, `ai.service.ts:27-61`)
returns the **same tenant-wide aggregates** (students, teachers, classes,
attendance, pending invoices, total collected) to **any** of `admin / teacher /
accountant`. It is tenant-scoped but **not per-user permission-scoped** — a teacher
gets the same fee/collection totals an accountant does. Phase 1's requirement —
*"the copilot may only read what the calling user's permissions already allow"* —
therefore means the retrieval layer must be **rebuilt to gate each data pull on the
caller's effective permissions**, not just on tenant. Treat Phase 1 as:

1. **Harden** the retrieval path to per-user permission enforcement (§4, §5), and
2. **Compose** the existing deterministic `/ai-insights` reads + `help` search into
   a conversational, cited, read-only surface.

This is consistent with the master doc's "correctness before features" posture and
its dependency on `PR-T0`/`PR-T2`.

---

## 3. Scope & hard guardrails (non-negotiable)

Phase 1 is bound by these guardrails, aligned to the master doc's §6 tenant
security rules and `CLAUDE.md`:

1. **Read-only ONLY.** No direct data changes of any kind. No auto-create, no
   auto-update, no auto-delete, no soft-delete.
2. **No auto-send / no enqueue.** Communication drafts are **returned as text**;
   nothing is written to `communication`, no job is enqueued, no provider is called.
3. **Existing tenant APIs only.** The copilot calls the **same permissioned service
   functions the UI uses** (`aiinsights.service`, `students.service`, `fees.service`,
   `jobs.service.listJobs`, `help.service.search`, `adminconsole.listAuditLogs`, …).
   **No new privileged data path, no raw cross-tenant SQL.**
4. **Respects RBAC — per user, server-side.** Every retrieval is gated on the
   caller's **effective permissions** (`userHasPermission` / `effectivePermissions`).
   Frontend hiding is not security (master §6.3).
5. **Respects tenant isolation.** Every retrieval scoped to `tenantId(req)` /
   `institution_id`; it inherits the `PR-T0` in-tenant FK validation. It can never
   read another tenant.
6. **All prompts + actions audited.** One `ai.copilot.query` event per turn, with a
   **masked** prompt + the tools/services invoked (§4.4), visible in the tenant
   `/activity` viewer.
7. **Secrets + PII masked.** `maskSecrets`/`maskFreeText` applied to prompt-assembly
   context and the audit payload; PII is limited to what the caller can already see.
8. **Feature-flag controlled, off by default.** Gated on an **opt-in** flag
   (`featureFlags.aiCopilot === true`) **and** `OPENAI_API_KEY` present; **degrades
   gracefully** (503 / disabled) when either is missing (§7).

**In scope for Phase 1:** conversational read/summary/draft answers over the 10 use
cases in §6, per-user + per-tenant scoped, audited, masked, flagged, with
Mongo-optional history. **Everything in §8 (What the AI must NOT do) is excluded.**

---

## 4. Architecture / data-access plan

```
POST /ai/copilot                (new route on the existing /ai router family)
  authenticate                  → req.user (id, role, institutionId)
  requireTenant                 → non-null institutionId (tenant scope)
  requireFeatureOptIn("aiCopilot")  → OFF unless settings.featureFlags.aiCopilot === true
  requirePermission("ai:copilot")   → base permission to open the surface
  copilotRateLimiter            → per-user + per-tenant cap + cost guard (§4.5)
        │
        ▼
  copilot.service.answer(user, institutionId, message, conversationId?)
     1. Intent routing (deterministic, allow-listed) ─────────────┐
     2. Retrieval layer  → ONLY permissioned service fns          │  §4.1
     3. Prompt assembly  → mask + compact the retrieved facts     │  §4.2
     4. LLM call (optional) or deterministic fallback             │  §4.3
     5. Audit ai.copilot.query (masked) + logUsage                │  §4.4
     6. Persist turn to Mongo ai_conversations (optional)         │
        │
        ▼
  { reply, sources[], conversationId|null, aiAvailable }
```

### 4.1 Retrieval layer — permissioned service calls only

- A small **allow-list of retrievers**, each mapped to (a) an existing service
  function and (b) the **permission key it requires**. Example shape:
  `{ key:"fees.outstanding", perm:"fees:read", call: () => feeRisk(institutionId, userId) }`.
- Before any retriever runs, the layer checks
  `await userHasPermission(req.user, retriever.perm)`. **If the caller lacks the
  perm, that retriever is silently omitted** (not just hidden in the UI) — so the
  model literally never receives data the user can't see.
- Retrievers call **existing services** (which already carry `institution_id`
  filters and, post-`PR-T0`, in-tenant FK validation). **No new SQL** is written for
  the copilot; the retrieval surface can only ever return what an equivalent UI page
  would return for this user.
- Cross-tenant is structurally impossible: retrievers take `tenantId(req)` and the
  services filter on it; there is no code path that accepts a foreign
  `institution_id`.

### 4.2 Prompt assembly with masking

- The system prompt states the copilot is **read-only**, must **cite the source
  metric/doc for every claim**, and must **never invent numbers or names** (reuse
  the existing `narrate()` instruction, `aiinsights.service.ts:434`).
- The retrieved facts are compacted to metrics/labels and passed through
  `maskSecrets` before assembly; any free-text (e.g. an audit reason) through
  `maskFreeText`. **Known residual limitation** (documented on `maskFreeText`): a
  secret without a recognizable prefix isn't caught — mitigated because retrievers
  return **already-permissioned, already-masked service output** (e.g.
  `documentSearch` uses **metadata only, never file contents/keys**,
  `aiinsights.service.ts:210`), not raw rows.
- **Term-aware output:** the assembled prompt carries the tenant's mode so replies
  use `useTerms()` nouns (Teacher/Faculty, Class/Program, Section/Batch, Term/
  Semester) — consistent with the master's School↔College engine.

### 4.3 LLM call — optional, with deterministic fallback

- If `OPENAI_API_KEY` is set: one `chat.completions` call (`env.openaiModel`,
  bounded `max_tokens`) that **only phrases** the retrieved facts. On error it
  falls back to a deterministic template (mirroring `narrate()` returning `null`).
- If unset: the surface returns **503** for the conversational route (like
  `ai.service.ts:69`), while the deterministic `/ai-insights` reads remain
  available on their own routes. `aiAvailable:false` is surfaced so the UI degrades.

### 4.4 Audit — one event per query, masked

- A dedicated write per turn (modeled on help.service `recordAudit` /
  `middleware/audit.ts`), **not** relying on the generic `auditLog` middleware
  (which **skips GET** and never captures the prompt):
  `action:"ai.copilot.query"`, `institution_id`, `actor_id/role`, `detail:{
  promptMasked: maskFreeText(message), retrieversUsed:[…], aiAvailable, replyChars }`.
- Written to the tenant **`audit_logs`** trail so it appears in the tenant
  **`/activity`** viewer; **degrades silently** without Mongo (best-effort insert,
  `.catch(()=>undefined)`), plus `logUsage("copilot", …)` → `ai_usage`.

### 4.5 Rate-limiting + cost guard

- A **`copilotRateLimiter`** in the `express-rate-limit` family, keyed by
  **`user:<id>`** (per-user, tighter than the tenant bucket) and additionally
  bounded per tenant via the existing `tenantRateLimiter` semantics.
- **Cost guard:** cap turns/user/day + a per-turn `max_tokens` ceiling + optional
  monthly token budget per tenant (new `env` var, defaults conservative, added via
  `config/env.ts` + both `.env.example` per `CLAUDE.md`); when exceeded, return a
  friendly "copilot quota reached" (HTTP 429) — never silently drop the guard.

### 4.6 History — Mongo optional

- Reuse `ai_conversations` (already indexed `{userId, updatedAt}`, `mongo.ts`).
  History is scoped by `userId`; last-N turns replayed like `ai.service.ts:85`.
- **No Mongo → no persistence**, single-turn still works (matches `getMongoDb()`
  null-guards throughout).

---

## 5. Suggested first use cases (the 10)

For each: the **existing read services/tables** it calls, the **permission gate it
inherits**, and the **exact output** — always a read / summary / draft, **never an
action.** All are additionally gated by `ai:copilot` + the feature flag + tenant
scope, and every line is **omitted if the caller lacks the underlying read perm.**

| # | Use case | Reads (existing services / tables) | Inherited perm gate | Exact output (read/summary/draft only) |
|---|----------|------------------------------------|---------------------|----------------------------------------|
| 1 | **What needs attention today** | `aiinsights.workflowSuggestions()` + `insightsDashboard()` (fee dues, pending leave, overdue books, low stock, transport/hostel dues) + `dashboard` stats | `ai:read`; each line expands only if the caller holds that module's read perm | A **prioritized read-only list** of counts with deep-links to the manual screens. No action taken. |
| 2 | **Summarize attendance issues** | `aiinsights.summarize("attendance")` + `attendanceRisk()` (`attendance_records`, tenant-scoped) | `ai:summarize` / `ai:risk_alerts` (+ attendance read) | KPI summary + at-risk student list (names only if caller can already see students). **Suggests** contacting guardians via existing screen; sends nothing. |
| 3 | **Summarize fee outstanding** | `aiinsights.summarize("fees")` + `feeRisk()` (`invoices` scoped via `students.institution_id`) | `ai:summarize` / `ai:risk_alerts` (+ `fees:read`) | Outstanding + overdue totals + top invoices. `suggestedAction` stays **"Send fee reminders via Communication (manual trigger)"**. |
| 4 | **Summarize exam readiness** | `aiinsights.summarize("exams")` + exams service (schedules, entered-vs-pending results, report-card status) | `ai:summarize` (+ exams read) | Readiness summary (what's scheduled, marks pending, report cards not generated). No generation triggered. |
| 5 | **Summarize tenant health** | `aiinsights.insightsDashboard()` headline (students/staff/feesOutstanding/attendanceRate) + `dashboard` stats | `ai:read` | A one-screen health snapshot. Read-only. |
| 6 | **Explain failed jobs / errors** | `jobs.service.listJobs(scope=institutionId, {status:"failed"})` + job detail `last_error` (**tenant** jobs only) | `jobs:read` | Plain-language explanation of the caller's **own** failed jobs; **points to the existing manual Retry button** — never auto-retries. |
| 7 | **Draft parent communication** | Permissioned student/guardian context (`students.service`) — **read only** | communication read to draft; caller needs `communication:send` to later send **manually** | A **DRAFT string** pre-filled into the existing composer. **DO NOT SEND** — nothing written to `communication`, nothing enqueued. |
| 8 | **Weekly school-admin report** | Composes `reportcenter` / `aiinsights` read outputs into a narrative digest | reports read + `ai:summarize` | A **read-only report document** (viewable; exportable only via the existing reason-gated + audited export). **Does not auto-schedule or email.** |
| 9 | **Find risky audit / security events** | `adminconsole.listAuditLogs({institutionId})` via the tenant `/activity` path (own-tenant forced) — failed logins, permission changes, bulk exports | `authorize("admin")` (the activity viewer is admin-only) | A read-only summary that **cites the audit rows**. No security action taken. |
| 10 | **Answer from SOP / help docs** | `help.service.search()` / `listSops` / `getArticle` over the **curated-in-code** corpus (rides the planned tenant Help/SOP surface, master §3 #30) | new tenant `help:read` | An answer that **cites the SOP/article id**. If no doc matches, it says so — **never fabricates**. |

Cross-cutting output contract: **every factual claim cites its source metric or
doc id**; when the caller lacks a permission the relevant line is **absent** (the
model never sees it), not redacted-after-the-fact.

---

## 6. What the AI must NOT do (explicit)

The copilot must **never**:

1. **Mutate anything** — no create/update/delete/soft-delete, no settings or RBAC
   changes, no status transitions.
2. **Send or enqueue messages** — no email/SMS/push, no `communication` write, no
   job enqueue, no provider call. Drafts are returned as text only.
3. **Bypass RBAC** — no retrieval runs without the caller's effective permission;
   no "admin-level" read on behalf of a lower-privileged caller.
4. **Bypass tenant scope / read another tenant** — no code path accepts a foreign
   `institution_id`; no unfiltered joins to shared tables.
5. **Surface secrets or PII beyond the caller's existing access** — masking applied;
   retrievers return already-permissioned, already-masked service output; document
   search stays metadata-only.
6. **Fabricate data** — every claim must cite a source metric/doc; when data is
   missing it must say "no data", never invent numbers or names.
7. **Auto-schedule, auto-approve, auto-retry, or auto-export** — it may *describe*
   the manual action and deep-link to it; the human performs it.
8. **Persist anything outside its own audit + optional chat history** — no writes to
   domain tables of any kind.

A **build-time test** (reuse `scanForSecrets` over any bundled copilot strings) and
a **unit test asserting no retriever issues a write / accepts a foreign tenant**
enforce this list.

---

## 7. Safeguards + feature-flag & rollout

### 7.1 Safeguards summary

| Safeguard | Mechanism (reused) |
|-----------|--------------------|
| Read-only | Retrieval allow-list contains **only read service fns**; no write/enqueue reachable. |
| Per-user RBAC | `userHasPermission` before every retriever; `effectivePermissions` for the surface. |
| Tenant isolation | `tenantId(req)` + `institution_id`-filtered services; inherits `PR-T0` FK validation. |
| Masking | `maskSecrets` (context + audit), `maskFreeText` (prompt/reason), metadata-only search. |
| Audit | `ai.copilot.query` per turn (masked) → tenant `audit_logs` → `/activity` viewer. |
| Rate + cost | Per-user `copilotRateLimiter` + per-tenant budget + `max_tokens` ceiling → 429 on breach. |
| Graceful degradation | 503 when `OPENAI_API_KEY` unset; no Mongo → no history; optional-dep contract kept. |
| No-secret proof | Build-time `scanForSecrets` over any bundled strings; write/tenant unit tests. |

### 7.2 Feature-flag design decision (important)

`requireFeature` is **DEFAULT-ALLOW** (`feature-flag.ts:37` — enabled unless
`=== false`). Phase 1 must be **OFF by default**, so **do not** gate the copilot with
plain `requireFeature`. Instead add a small **opt-in** variant —
`requireFeatureOptIn("aiCopilot")` — that passes **only when
`settings.featureFlags.aiCopilot === true`** (default-deny), reusing the same
JSONB source, TTL cache, `invalidateFeatureFlagCache` bust, and `super_admin`
bypass. Effective gate = **opt-in flag AND `OPENAI_API_KEY` present AND
`ai:copilot` permission**. This keeps the established pattern while inverting the
default for a net-new, higher-risk surface.

### 7.3 Rollout

1. **Dark / off everywhere** — merged behind the opt-in flag; no tenant sees it.
2. **Internal pilot** — enable `aiCopilot` for 1–2 friendly pilot tenants; watch
   `ai_usage`, `ai.copilot.query` audit, cost, and refusal quality.
3. **Limited GA** — document the flag in the tenant Settings module toggles
   (master §5 Settings) so a super-admin can enable per tenant; keep default-off.
4. **Kill switch** — flip the flag off (cache busts) or unset `OPENAI_API_KEY`;
   the surface degrades to 503 with zero data risk.

New `ai:copilot` permission + `aiCopilot` flag key are **additive** (a new numbered
migration granting `ai:copilot` to `admin` only, per master §6.10 — granular over
blanket), never editing an applied migration (`CLAUDE.md`).

---

## 8. Future — Phase 2 / 3 (clearly deferred)

Each item is **out of scope for Phase 1** and would ship **only** with the extra
safeguards named.

| Phase | Idea | Extra safeguards required before it ships |
|------:|------|-------------------------------------------|
| 2 | **Guarded write-actions with human confirmation** (e.g. "send these fee reminders") | A **confirm-then-act** flow: copilot proposes → human reviews the exact payload → an **existing** permissioned write endpoint executes (never a copilot-authored SQL path); write perm re-checked at execution; idempotency + full audit of the confirmed action. |
| 2 | **Proactive digests** (scheduled "morning briefing") | Runs as a **tenant-scoped background job** (existing `jobs` infra) under a service identity constrained to the recipient's permissions; opt-in per user; still read-only; rate/cost budgeted. |
| 3 | **Embeddings / RAG over tenant documents** | Tenant-scoped vector store; index **metadata + explicitly-allowed** docs only (extend the current metadata-only `documentSearch`); per-doc ACL at retrieval; no cross-tenant vectors; PII review. |
| 3 | **Voice** | Same guardrails + transcript audited + no new data path; provider optional/degrading. |
| 3 | **Per-role copilots** (Principal / Accountant / Librarian views) | Rides **Tenant RBAC v2** (`PR-T2`) permission-sets; each role-copilot inherits exactly that role's read perms — no new grants. |

---

## 9. Phase 1 Definition of Done

- [ ] `POST /ai/copilot` behind `authenticate → requireTenant →
      requireFeatureOptIn("aiCopilot") → requirePermission("ai:copilot") →
      copilotRateLimiter`, with an `@openapi` block (Swagger-generated per `CLAUDE.md`).
- [ ] Retrieval layer is an **allow-list of existing service fns**, each gated by
      `userHasPermission` **per call**; **zero raw SQL**, **zero write path**,
      **zero foreign-tenant path** (proven by unit tests).
- [ ] All 10 use cases (§5) answer as **read / summary / draft only**, each claim
      **cites its source**, and each line is **omitted** when the caller lacks the perm.
- [ ] Every turn writes a **masked** `ai.copilot.query` audit event visible in
      `/activity`, and `logUsage` to `ai_usage`; both **degrade without Mongo**.
- [ ] `maskSecrets`/`maskFreeText` applied to context + audit; build-time
      `scanForSecrets` passes over any bundled strings.
- [ ] **503 / disabled** when `OPENAI_API_KEY` unset or the flag is not opt-in;
      **off by default**; kill switch verified.
- [ ] Rate-limit + cost guard enforced (429 on breach); new `env` budget var in
      `config/env.ts` + both `.env.example`.
- [ ] `backend typecheck + test` green; new isolation/permission/no-write tests
      added; **no changes to Super Admin or completed modules**; **no deploy** — open
      PR first, await approval (master §9 rules).

## 10. Explicitly out of scope for Phase 1

- Any **write, send, enqueue, schedule, approve, retry, or export-trigger** action
  (all deferred to Phase 2 confirm-then-act).
- **Proactive / scheduled** digests, **voice**, **embeddings/RAG** over document
  bodies, and **per-role** copilots (Phase 2/3).
- **Platform / Super Admin** data (cross-tenant analytics, platform `observability`,
  `platform_audit_log` global viewer) — tenant-only, always.
- **New domain data paths or SQL** for the copilot — it may only reuse existing
  permissioned services.
- **RBAC v2 itself** — Phase 1 consumes the current permission model; the finer
  per-role copilots wait on `PR-T2`.
- Building the **tenant Help/SOP corpus** — use case 10 consumes the surface planned
  in master §3 #30; this doc does not deliver that corpus.

---

*Consistency check: aligned with `TENANT-ADMIN-MASTER-ROADMAP.md` — same
PLANNING-ONLY posture, the wrap-up-layer 🔭/P2 placement, `PR-T5+` build position
and its `PR-T0`/`PR-T2`/Help-SOP dependencies, the §6 tenant-security rules, and the
existing optional-dependency + RBAC + masking + audit patterns cited from live code.*
