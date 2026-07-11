# AI Assistant & Insights Module

> **Status:** Implemented · **Backend:** `backend/src/modules/ai` + `backend/src/modules/aiinsights` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

Two related staff-facing capabilities:

- **AI assistant** (`ai/`) — a chat assistant grounded in **live, tenant-wide
  school statistics** (active students/teachers, attendance today, pending
  invoices, fees collected) injected into the system prompt, answered by OpenAI
  **GPT-4o**. Conversation history is persisted in **MongoDB** when available.
- **AI insights** (`aiinsights/`) — deterministic, tenant-scoped analytics with an
  optional GPT narrative layer: report/KPI summaries, attendance-risk and
  fee-risk alerts, semantic/keyword document search, and workflow suggestions,
  plus an insights dashboard.

Everything **degrades gracefully**: when `OPENAI_API_KEY` is unset the assistant
returns 503 and insight endpoints still return their deterministic metrics with a
`null` narrative and `aiAvailable: false`. When MongoDB is unset, conversation
history and usage logging are no-ops.

## 2. User roles involved

Assistant (`ai/`) is gated by **role**: `admin`, `teacher`, `accountant`
(via `authorize(...)`). Insights (`aiinsights/`) is gated by granular
permissions — admin holds all; teacher and accountant hold a subset (see §6).
`super_admin` bypasses permission checks. Students and parents have **no** AI
access.

## 3. Main screens / pages

- Assistant chat: **retired (PR-T11.1)** — `/assistant` now redirects to
  `/copilot` (the governed AI Copilot). The `POST /ai/assistant` API below
  still exists server-side but no longer has a first-party UI.
- AI insights hub: `/ai-insights` → `frontend/src/app/(dashboard)/ai-insights/page.tsx`,
  with subpages:
  - `/ai-insights/summaries` → `.../ai-insights/summaries/page.tsx`
  - `/ai-insights/search` → `.../ai-insights/search/page.tsx`
  - `/ai-insights/attendance-risk` → `.../ai-insights/attendance-risk/page.tsx`
  - `/ai-insights/fee-risk` → `.../ai-insights/fee-risk/page.tsx`

## 4. Main backend APIs

Assistant — `backend/src/modules/ai/ai.routes.ts`
(`authenticate, authorize("admin","teacher","accountant")`):

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| POST | `/ai/assistant` | Ask GPT-4o (grounded in live KPIs); 503 if no `OPENAI_API_KEY` | role gate (admin/teacher/accountant) |
| GET | `/ai/conversations` | List the caller's conversations (Mongo) | role gate |
| GET | `/ai/conversations/{id}` | Get a conversation with messages | role gate |

Insights — `backend/src/modules/aiinsights/aiinsights.routes.ts`
(`authenticate, requireTenant`):

| Method | Path | Purpose | Permission |
|--------|------|---------|------------|
| GET | `/ai-insights/dashboard` | Headline KPIs + workflow suggestions | `ai:read` |
| GET | `/ai-insights/summary/{report}` | Metrics (always) + optional GPT narrative for a report | `ai:summarize` |
| GET | `/ai-insights/risk/attendance` | Students below a threshold over a window | `ai:risk_alerts` |
| GET | `/ai-insights/risk/fees` | Overdue + high-due invoices (manual reminder only) | `ai:risk_alerts` |
| GET | `/ai-insights/search` | Semantic doc search (keyword fallback) | `ai:document_search` |
| GET | `/ai-insights/suggestions` | Deterministic workflow suggestions | `ai:workflow_suggestions` |

`summary/{report}` supports: attendance, fees, exams, homework, payroll, library,
transport, hostel, inventory.

## 5. Database tables / entities

- **No Postgres tables are owned by these modules.** They **read** aggregates from
  many tenant tables (`students`, `teachers`, `attendance_records`, `invoices`,
  `payments`, `exam_results`, `homework(_submissions)`, `payslips`, `book_issues`,
  `transport_routes`/`student_transport`, `hostel_rooms`/`hostel_allocations`,
  `inventory_items`, `leave_requests`, `documents`) — all filtered by
  `institution_id`.
- **MongoDB (optional)** collections:
  - `ai_conversations` — `{ userId, title, messages:[{role,content,createdAt}], createdAt, updatedAt }` (assistant history).
  - `ai_usage` — `{ kind, userId, institutionId, at }` best-effort insight-usage log.

## 6. Permissions / RBAC involved

- **Assistant** uses a **role gate** (`authorize`), not a permission key. A legacy
  `ai:use` permission exists (seeded in `0012_permissions.sql`) but the assistant
  route does not reference it — access is by role. **(to confirm)** whether
  `ai:use` is intended to gate the assistant in a later refactor.
- **Insights** uses granular keys seeded in `0031_ai_advanced.sql`:
  `ai:read`, `ai:summarize`, `ai:risk_alerts`, `ai:document_search`,
  `ai:workflow_suggestions`.
  - admin: all granular keys.
  - teacher: `ai:read`, `ai:summarize`, `ai:document_search` (no risk/suggestions).
  - accountant: all granular keys (incl. fee/attendance risk).
  - student/parent: none.
- `super_admin` bypasses `requirePermission`.

## 7. Tenant isolation notes

- Every insight query is parameterized by `institution_id` (`tenantId(req)`);
  there is no cross-tenant aggregation.
- Document search uses **metadata only** (`original_name`, `category`,
  `owner_type`) and never reads file contents or storage keys; results are
  tenant-scoped (`LIMIT 200` recent docs for semantic ranking, keyword `ILIKE`
  fallback).
- The assistant's `schoolContext` aggregates are **not** institution-filtered in
  the current implementation (they read global counts). **(to confirm)** —
  insights endpoints are tenant-scoped; the assistant's grounding snapshot should
  be reviewed before multi-tenant production use.
- Risk/suggestion outputs avoid sending PII to the model: narratives receive only
  counts/rates (e.g. "lowest: 60%, 64%"), with an explicit "do not invent names"
  instruction.

## 8. Key workflows

1. **Assistant chat:** `POST /ai/assistant { message, conversationId? }` → service
   builds the live-stats system prompt, calls GPT-4o (max 1000 tokens, last ~20
   turns of history), persists the turn to `ai_conversations` (if Mongo), returns
   `{ reply, conversationId }`.
2. **Summaries:** `GET /ai-insights/summary/{report}` runs the report's metric SQL
   (deterministic), derives ratios (e.g. 30-day attendance rate), logs usage, and
   optionally asks GPT for a short bullet narrative; returns `{ report, metrics,
   narrative, aiAvailable }`.
3. **Attendance risk:** active students with ≥ `minRecords` attendance over
   `windowDays` (default 60) whose rate < `threshold` (default 75%), sorted
   ascending, with an optional narrative.
4. **Fee risk:** pending/partially-paid invoices (overdue first), total
   outstanding, and a manual-reminder suggestion (reminders are sent only via
   Communication on explicit action).
5. **Document search:** when OpenAI is configured, embeds the query + recent doc
   metadata and ranks by cosine (`mode: semantic`); otherwise `ILIKE` keyword
   match (`mode: keyword`).
6. **Suggestions / dashboard:** deterministic counts (fee dues, pending leave,
   overdue books, low stock, transport/hostel dues) surfaced as actionable links.

## 9. Test coverage summary

- Integration: `backend/tests/integration/aiinsights.int.test.ts` — summary
  (attendance/fees) with graceful fallback when OpenAI is unconfigured; attendance
  + fee risk; keyword document search (no storage-key leakage); workflow
  suggestions; permission guards (teacher can read/summarize/search but not
  risk/suggestions; accountant has fee risk; student none); cross-institution
  isolation.
- `backend/tests/integration/threads.int.test.ts` covers threaded messaging
  (assistant conversation history is Mongo-backed and not exercised by the SQL
  integration suite).
- Run via `npm run test:integration`.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| `POST /ai/assistant` returns 503 | `OPENAI_API_KEY` not set | Set `OPENAI_API_KEY` (model via `OPENAI_MODEL`, default `gpt-4o`) |
| Summaries show metrics but no narrative | OpenAI unconfigured or call failed | Expected fallback — `narrative: null`, `aiAvailable: false`; set the key to enable |
| Conversation list empty / history not saved | MongoDB unconfigured (`MONGO_URL` unset) | Configure Mongo; history + usage logging are otherwise no-ops |
| Search always returns `mode: keyword` | OpenAI unset or embeddings call failed | Configure OpenAI for semantic ranking; keyword is the safe fallback |
| Teacher 403 on risk/suggestions | Teacher lacks `ai:risk_alerts`/`ai:workflow_suggestions` | Grant the keys or use an admin/accountant account |

## 11. Future enhancement notes

- Reconcile the assistant gate: either adopt the `ai:use` permission or keep the
  role gate, and scope `schoolContext` aggregates by `institution_id`.
- Persist embeddings (rather than recomputing per search) and broaden semantic
  search beyond metadata once a vector store is added.
- Optional auto-reminders remain intentionally manual (Communication on explicit
  action) to avoid unintended parent messages.
