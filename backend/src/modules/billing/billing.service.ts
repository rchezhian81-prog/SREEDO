import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { sendMail } from "../../utils/mailer";

/**
 * Subscription lifecycle (Billing Phase B1).
 *
 * A safe, additive sweep that:
 *  - opens a grace window when a term ends,
 *  - marks subscriptions `expired` once past term+grace (and trials past their end),
 *  - optionally suspends the institution on expiry (BILLING_AUTO_SUSPEND, off by default),
 *  - sends renewal reminders ahead of expiry,
 *  - records every change to the durable `subscription_events` audit trail.
 *
 * No payment gateway is involved. Perpetual subscriptions (NULL ends_at) are
 * never touched. The sweep is idempotent: re-running it the same day is a no-op.
 */

export type SweepActor = { id: string; email: string } | null;

export interface SweepSummary {
  graceStarted: number;
  expired: number;
  trialExpired: number;
  autoSuspended: number;
  remindersSent: number;
  ranAt: string;
}

interface EventInput {
  institutionId: string;
  subscriptionId: string | null;
  event: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown>;
  actor?: SweepActor;
}

/** Append a durable subscription-change record. Best-effort: never throws. */
export async function recordSubscriptionEvent(input: EventInput): Promise<void> {
  try {
    await query(
      `INSERT INTO subscription_events
         (institution_id, subscription_id, event, from_status, to_status,
          actor_id, actor_email, detail, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        input.institutionId,
        input.subscriptionId,
        input.event,
        input.fromStatus ?? null,
        input.toStatus ?? null,
        input.actor?.id ?? null,
        input.actor?.email ?? null,
        JSON.stringify(input.detail ?? {}),
        input.reason ?? null,
      ]
    );
  } catch (err) {
    console.error(`Failed to record subscription event ${input.event}:`, err);
  }
}

export interface EffectiveLifecycleConfig {
  trialDays: number;
  graceDays: number;
  reminderDays: number[]; // days BEFORE expiry (renewal reminders)
  expiryReminderDays: number[]; // days AFTER expiry
  autoExpire: boolean;
  autoSuspend: boolean;
  billingOverdueSuspend: boolean;
  enforce: boolean; // env-only (requireActiveSubscription); not in the DB config
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/**
 * The effective lifecycle configuration. Prefers the DB-backed singleton
 * (subscription_lifecycle_config, editable by the super-admin in Super Admin D)
 * and falls back to the B1 env defaults when the row is absent — so the sweep
 * behaves identically on a fresh DB and honours operator edits when present.
 */
export async function effectiveLifecycleConfig(): Promise<EffectiveLifecycleConfig> {
  const { rows } = await query<{
    trial_days: number; grace_days: number;
    renewal_reminder_days: number[]; expiry_reminder_days: number[];
    auto_expire_enabled: boolean; auto_suspend_enabled: boolean;
    billing_overdue_suspend_enabled: boolean;
    updated_at: string | null; updated_by_email: string | null;
  }>(
    `SELECT trial_days, grace_days, renewal_reminder_days, expiry_reminder_days,
            auto_expire_enabled, auto_suspend_enabled, billing_overdue_suspend_enabled,
            to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at, updated_by_email
     FROM subscription_lifecycle_config WHERE id = 1`
  );
  const r = rows[0];
  if (!r) {
    return {
      trialDays: 14,
      graceDays: env.billingGraceDays,
      reminderDays: env.billingReminderDays,
      expiryReminderDays: [0, 7],
      autoExpire: true,
      autoSuspend: env.billingAutoSuspend,
      billingOverdueSuspend: false,
      enforce: env.billingEnforceSubscription,
      updatedAt: null,
      updatedByEmail: null,
    };
  }
  return {
    trialDays: r.trial_days,
    graceDays: r.grace_days,
    reminderDays: r.renewal_reminder_days ?? [],
    expiryReminderDays: r.expiry_reminder_days ?? [],
    autoExpire: r.auto_expire_enabled,
    autoSuspend: r.auto_suspend_enabled,
    billingOverdueSuspend: r.billing_overdue_suspend_enabled,
    enforce: env.billingEnforceSubscription,
    updatedAt: r.updated_at,
    updatedByEmail: r.updated_by_email,
  };
}

/** Pure helper (unit-tested): the renewal-reminder email body. */
export function renewalReminderEmail(
  daysUntil: number,
  packageName: string | null,
  endsAt: string
): { subject: string; text: string } {
  const plan = packageName ? `"${packageName}" ` : "";
  const when =
    daysUntil <= 0
      ? "today"
      : daysUntil === 1
        ? "in 1 day"
        : `in ${daysUntil} days`;
  return {
    subject: `Your SRE EDU OS subscription renews ${when}`,
    text:
      `This is a reminder that your ${plan}subscription expires on ${endsAt} ` +
      `(${when}). Please renew to avoid any interruption to your school's access. ` +
      `Contact your SRE EDU OS administrator to renew.`,
  };
}

async function institutionAdminEmails(institutionId: string): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM users
     WHERE institution_id = $1 AND role = 'admin' AND is_active = true`,
    [institutionId]
  );
  return rows.map((r) => r.email);
}

/**
 * Run one lifecycle sweep. `actor` is null for automated (worker) runs and the
 * super-admin for a manual trigger. Returns a summary of what changed.
 */
export async function sweepSubscriptionLifecycle(
  actor: SweepActor = null
): Promise<SweepSummary> {
  const cfg = await effectiveLifecycleConfig();
  const graceDays = cfg.graceDays;
  const reminderDays = cfg.reminderDays;
  const autoExpire = cfg.autoExpire;
  const summary: SweepSummary = {
    graceStarted: 0,
    expired: 0,
    trialExpired: 0,
    autoSuspended: 0,
    remindersSent: 0,
    ranAt: new Date().toISOString(),
  };

  // 1. Open a grace window the first day a term lapses (idempotent: only when unset).
  const grace = await query<{
    id: string;
    institution_id: string;
    grace_until: string;
  }>(
    `UPDATE institution_subscriptions
       SET grace_until = ends_at + $1::int
     WHERE status IN ('active','trialing')
       AND ends_at IS NOT NULL
       AND CURRENT_DATE > ends_at
       AND CURRENT_DATE <= ends_at + $1::int
       AND grace_until IS NULL
     RETURNING id, institution_id, grace_until`,
    [graceDays]
  );
  for (const r of grace.rows) {
    summary.graceStarted += 1;
    await recordSubscriptionEvent({
      institutionId: r.institution_id,
      subscriptionId: r.id,
      event: "grace_started",
      detail: { graceUntil: r.grace_until },
      actor,
    });
  }

  // 2. Expire trials past their trial end (CTE captures the prior status).
  const trial = await query<{
    id: string;
    institution_id: string;
    from_status: string;
  }>(
    `WITH due AS (
       SELECT id, institution_id, status FROM institution_subscriptions
       WHERE status = 'trialing'
         AND trial_ends_at IS NOT NULL
         AND CURRENT_DATE > trial_ends_at
         AND $1::boolean
       FOR UPDATE
     )
     UPDATE institution_subscriptions s SET status = 'expired'
     FROM due WHERE s.id = due.id
     RETURNING s.id, s.institution_id, due.status AS from_status`,
    [autoExpire]
  );
  for (const r of trial.rows) {
    summary.trialExpired += 1;
    await recordSubscriptionEvent({
      institutionId: r.institution_id,
      subscriptionId: r.id,
      event: "trial_expired",
      fromStatus: r.from_status,
      toStatus: "expired",
      actor,
    });
  }

  // 3. Expire terms past term+grace.
  const expired = await query<{
    id: string;
    institution_id: string;
    from_status: string;
  }>(
    `WITH due AS (
       SELECT id, institution_id, status FROM institution_subscriptions
       WHERE status IN ('active','trialing')
         AND ends_at IS NOT NULL
         AND CURRENT_DATE > COALESCE(grace_until, ends_at + $1::int)
         AND $2::boolean
       FOR UPDATE
     )
     UPDATE institution_subscriptions s SET status = 'expired'
     FROM due WHERE s.id = due.id
     RETURNING s.id, s.institution_id, due.status AS from_status`,
    [graceDays, autoExpire]
  );
  for (const r of expired.rows) {
    summary.expired += 1;
    await recordSubscriptionEvent({
      institutionId: r.institution_id,
      subscriptionId: r.id,
      event: "expired",
      fromStatus: r.from_status,
      toStatus: "expired",
      actor,
    });
  }

  // 4. Optional auto-suspend for institutions whose subscription just expired.
  if (cfg.autoSuspend) {
    const justExpired = [...trial.rows, ...expired.rows];
    for (const r of justExpired) {
      const res = await query<{ id: string }>(
        // PR-SEC2 status alignment: an expiry auto-suspend also marks status.
        `UPDATE institutions SET is_active = false, status = 'suspended'
         WHERE id = $1 AND is_active = true RETURNING id`,
        [r.institution_id]
      );
      if (res.rows[0]) {
        summary.autoSuspended += 1;
        await recordSubscriptionEvent({
          institutionId: r.institution_id,
          subscriptionId: r.id,
          event: "auto_suspended",
          detail: { reason: "subscription_expired" },
          actor,
        });
      }
    }
  }

  // 5. Renewal reminders ahead of expiry (best-effort email; always recorded).
  if (reminderDays.length) {
    const due = await query<{
      id: string;
      institution_id: string;
      package_name: string | null;
      ends_at: string;
      days_until: number;
    }>(
      `SELECT s.id, s.institution_id, p.name AS package_name,
              to_char(s.ends_at, 'YYYY-MM-DD') AS ends_at,
              (s.ends_at - CURRENT_DATE) AS days_until
       FROM institution_subscriptions s
       JOIN subscription_packages p ON p.id = s.package_id
       WHERE s.status IN ('active','trialing')
         AND s.ends_at IS NOT NULL
         AND (s.ends_at - CURRENT_DATE) = ANY($1::int[])
         AND (s.last_reminder_day IS DISTINCT FROM (s.ends_at - CURRENT_DATE))`,
      [reminderDays]
    );
    for (const r of due.rows) {
      await query(
        `UPDATE institution_subscriptions
           SET last_reminder_at = now(), last_reminder_day = $2
         WHERE id = $1`,
        [r.id, r.days_until]
      );
      summary.remindersSent += 1;
      const mail = renewalReminderEmail(r.days_until, r.package_name, r.ends_at);
      try {
        const recipients = await institutionAdminEmails(r.institution_id);
        for (const to of recipients) {
          await sendMail({ to, subject: mail.subject, text: mail.text });
        }
      } catch (err) {
        console.error("renewal reminder email failed:", err);
      }
      await recordSubscriptionEvent({
        institutionId: r.institution_id,
        subscriptionId: r.id,
        event: "reminder_sent",
        detail: { daysUntil: r.days_until, endsAt: r.ends_at },
        actor,
      });
    }
  }

  return summary;
}

export interface SubscriptionStatus {
  id: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  graceUntil: string | null;
  trialEndsAt: string | null;
  renewsAt: string | null;
  autoRenew: boolean;
  packageName: string | null;
  isActiveNow: boolean;
  // B4 recurring/dunning state (safe to expose; no secrets).
  autoCharge: boolean;
  dunningState: string;
  dunningAttempts: number;
  nextRetryAt: string | null;
  lastChargeAt: string | null;
  lastPaymentError: string | null;
}

/** Current subscription + a computed `isActiveNow` (honours grace). */
export async function subscriptionStatus(
  institutionId: string
): Promise<SubscriptionStatus | null> {
  const { rows } = await query<SubscriptionStatus>(
    `SELECT s.id, s.status,
            to_char(s.starts_at, 'YYYY-MM-DD') AS "startsAt",
            to_char(s.ends_at, 'YYYY-MM-DD') AS "endsAt",
            to_char(s.grace_until, 'YYYY-MM-DD') AS "graceUntil",
            to_char(s.trial_ends_at, 'YYYY-MM-DD') AS "trialEndsAt",
            to_char(s.renews_at, 'YYYY-MM-DD') AS "renewsAt",
            s.auto_renew AS "autoRenew",
            s.auto_charge AS "autoCharge",
            s.dunning_state AS "dunningState",
            s.dunning_attempts AS "dunningAttempts",
            to_char(s.next_retry_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "nextRetryAt",
            to_char(s.last_charge_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastChargeAt",
            s.last_payment_error AS "lastPaymentError",
            p.name AS "packageName",
            (s.status IN ('active','trialing')
              AND (s.ends_at IS NULL
                   OR CURRENT_DATE <= COALESCE(s.grace_until, s.ends_at + $2::int)))
              AS "isActiveNow"
     FROM institution_subscriptions s
     JOIN subscription_packages p ON p.id = s.package_id
     WHERE s.institution_id = $1
     ORDER BY s.created_at DESC LIMIT 1`,
    [institutionId, env.billingGraceDays]
  );
  return rows[0] ?? null;
}

/** Recent lifecycle audit events for one institution. */
export async function listSubscriptionEvents(
  institutionId: string,
  limit = 50
): Promise<unknown[]> {
  const { rows } = await query(
    `SELECT id, event, from_status AS "fromStatus", to_status AS "toStatus",
            actor_email AS "actorEmail", detail, created_at AS "createdAt"
     FROM subscription_events
     WHERE institution_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [institutionId, limit]
  );
  return rows;
}

export interface LifecycleConfig {
  autoSuspend: boolean;
  enforce: boolean;
  graceDays: number;
  reminderDays: number[];
}

/**
 * Current lifecycle configuration — reflects the environment flags so the
 * super-admin UI can show whether auto-suspend / enforcement are ON or OFF.
 * Read-only; contains no secrets and changes no behaviour.
 */
export function lifecycleConfig(): LifecycleConfig {
  return {
    autoSuspend: env.billingAutoSuspend,
    enforce: env.billingEnforceSubscription,
    graceDays: env.billingGraceDays,
    reminderDays: env.billingReminderDays,
  };
}

export interface SubscriptionRow {
  institutionId: string;
  institutionName: string;
  code: string;
  institutionActive: boolean;
  status: string | null;
  packageName: string | null;
  endsAt: string | null;
  graceUntil: string | null;
  trialEndsAt: string | null;
  isActiveNow: boolean;
}

/** Every institution with its latest subscription status (read-only list). */
export async function listAllSubscriptionStatuses(): Promise<SubscriptionRow[]> {
  const { rows } = await query<SubscriptionRow>(
    `SELECT i.id AS "institutionId", i.name AS "institutionName", i.code,
            i.is_active AS "institutionActive",
            s.status,
            p.name AS "packageName",
            to_char(s.ends_at, 'YYYY-MM-DD') AS "endsAt",
            to_char(s.grace_until, 'YYYY-MM-DD') AS "graceUntil",
            to_char(s.trial_ends_at, 'YYYY-MM-DD') AS "trialEndsAt",
            COALESCE(
              s.status IN ('active','trialing')
                AND (s.ends_at IS NULL
                     OR CURRENT_DATE <= COALESCE(s.grace_until, s.ends_at + $1::int)),
              false
            ) AS "isActiveNow"
     FROM institutions i
     LEFT JOIN LATERAL (
       SELECT * FROM institution_subscriptions s2
       WHERE s2.institution_id = i.id
       ORDER BY s2.created_at DESC LIMIT 1
     ) s ON true
     LEFT JOIN subscription_packages p ON p.id = s.package_id
     ORDER BY i.name`,
    [env.billingGraceDays]
  );
  return rows;
}
