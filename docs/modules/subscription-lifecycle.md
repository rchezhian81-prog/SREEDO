# Subscription Lifecycle — Billing Phase B1

Automates the *operator → institution* subscription lifecycle: grace windows,
expiry, optional auto-suspend, renewal reminders, status tracking, and a durable
audit trail. **Safe and additive — no payment gateway, no destructive
migrations, no data deletion.** This is Phase B1 of `docs/SAAS_BILLING_ROADMAP.md`.

> Unrelated to **student fee collection** (`modules/fees`, `modules/onlinepayments`),
> which is a separate, mature feature.

## What it does

| Behaviour | Detail |
|---|---|
| **Grace window** | The first day a term lapses (`CURRENT_DATE > ends_at`), `grace_until = ends_at + BILLING_GRACE_DAYS` is set once; the subscription stays usable during grace. |
| **Expiry** | Past `ends_at + grace`, status → `expired`. Trials past `trial_ends_at` → `expired`. |
| **Auto-suspend** | *Off by default.* When `BILLING_AUTO_SUSPEND=true`, an expired subscription also sets `institutions.is_active = false` (reversible). |
| **Renewal reminders** | On each of `BILLING_REMINDER_DAYS` before `ends_at`, emails the institution's admins (best-effort; skipped if SMTP unset) and records the reminder. Each day fires at most once (`last_reminder_day`). |
| **Status tracking** | New columns + a computed `isActiveNow` (honours grace). |
| **Audit** | Every change is written to `subscription_events`. |

Perpetual subscriptions (`ends_at IS NULL`) are never touched. The sweep is
**idempotent** — re-running it the same day is a no-op.

## Schema — migration `0072_subscription_lifecycle.sql`

- `institution_subscriptions` gains: `renews_at`, `grace_until`, `trial_ends_at`,
  `auto_renew` (default `true`), `last_reminder_at`, `last_reminder_day`.
- `status` CHECK widened to add `expired` (all existing values kept).
- Index `institution_subscriptions_status_ends_idx` for the sweep.
- New table `subscription_events` (institution_id, subscription_id, event,
  from_status, to_status, actor_id/email, detail JSONB, created_at) — `actor_id`
  NULL means an automated/system change.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `BILLING_GRACE_DAYS` | `14` | Days of grace after a term ends before expiry. |
| `BILLING_REMINDER_DAYS` | `14,7,1` | Days-before-expiry to send reminders. |
| `BILLING_AUTO_SUSPEND` | off | Suspend the institution on expiry. |
| `BILLING_ENFORCE_SUBSCRIPTION` | off | Enable the placeholder write-block guard. |

All optional; sensible, **non-disruptive defaults** (nothing is suspended or
blocked unless explicitly enabled). Defined in `config/env.ts` + `.env.example`.

## How the sweep runs

1. **In the background worker tick** — `startWorker()` (jobs.worker.ts) calls
   `sweepSubscriptionLifecycle()` each tick when `JOB_WORKER_ENABLED=true`.
2. **On demand** — `POST /platform/subscriptions/run-lifecycle` (super-admin),
   for cron-style triggering without the in-process worker, e.g.:
   ```bash
   curl -X POST https://app.example.com/api/v1/platform/subscriptions/run-lifecycle \
     -H "Authorization: Bearer <super-admin-token>"
   # -> { "graceStarted": 1, "expired": 2, "trialExpired": 0,
   #      "autoSuspended": 0, "remindersSent": 3, "ranAt": "..." }
   ```

## Endpoints (super-admin, under `/platform`)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/platform/subscriptions/run-lifecycle` | `platform:manage_subscriptions` | Run the sweep now; returns a summary |
| GET | `/platform/institutions/:id/subscription/status` | `platform:read` | Current status + `isActiveNow` |
| GET | `/platform/institutions/:id/subscription/events` | `platform:audit_read` | Recent lifecycle events |

## Enforcement placeholder (not yet active)

`modules/billing/billing.middleware.ts` exports `requireActiveSubscription` — a
ready-but-**unmounted** guard. It is a no-op unless `BILLING_ENFORCE_SUBSCRIPTION=true`,
and when enabled it allows all reads (so a lapsed tenant can still export its
data) and blocks only state-changing requests with `402`. To activate later,
mount it after `requireTenant` on the desired routers. It never deletes data and
is fully reversible (renewing flips `isActiveNow`).

## Tests

- `src/modules/billing/billing.service.test.ts` — unit (reminder copy).
- `tests/integration/billing.int.test.ts` — expiry, grace, trial expiry,
  reminders, idempotency, and the auto-suspend-off default (verified against
  Postgres in CI).

## Not in B1 (see the roadmap)
SaaS invoices, tax/GST, recurring charging via a gateway, dunning, metering, and
mounting the enforcement guard are later phases (B2–B5).
