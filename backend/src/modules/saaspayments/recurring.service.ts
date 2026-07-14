import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { sendMail, mailerConfigured } from "../../utils/mailer";
import * as invoices from "../billing/invoices.service";
import * as platform from "../platform/platform.service";
import {
  getResolvedConfig,
  recurringActive,
  createPaymentLink,
  billingCycleInterval,
  recordAuditTx,
  recordSubscriptionEventTx,
} from "./saaspayments.service";

/**
 * Online recurring billing + dunning (Billing Phase B4).
 *
 * A safe, additive sweep on top of C-4's SaaS Razorpay gateway and B1's
 * lifecycle. It (1) generates + issues + payment-links the next-period renewal
 * invoice for opted-in subscriptions, and (2) runs a bounded dunning retry
 * schedule that ends in an (optional) tenant suspend.
 *
 * OFF BY DEFAULT and GRACEFULLY DEGRADING: every path is a clean no-op unless the
 * operator has switched on `auto_charge_enabled` AND configured the gateway
 * (`recurringActive`) — and, per subscription, `auto_renew` + `auto_charge`. No
 * data is ever deleted; suspension is reversible and audited. Re-running the tick
 * the same day is idempotent (an open renewal invoice blocks re-generation; the
 * dunning clock only advances once `next_retry_at` has passed).
 */

export type RecurringActor = { id: string; email: string } | null;

export interface RecurringSummary {
  enabled: boolean; // recurring master switch + gateway configured
  renewalsGenerated: number;
  dunningRetried: number;
  dunningExhausted: number;
  suspended: number;
  ranAt: string;
}

interface DueSub {
  id: string;
  institutionId: string;
  packageId: string | null;
  cycle: string | null;
  renewsAt: string | null;
  endsAt: string | null;
  currency: string | null;
  packageName: string | null;
}

/** Institution admin emails (best-effort recipients for the renewal link). */
async function institutionAdminEmails(institutionId: string): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM users
     WHERE institution_id = $1 AND role = 'admin' AND is_active = true`,
    [institutionId]
  );
  return rows.map((r) => r.email);
}

/** Email the payment link to the tenant's admins (best-effort; degrades if no SMTP). */
async function emailRenewalLink(
  institutionId: string,
  invoiceNumber: string | null,
  currency: string,
  total: string,
  url: string | null,
  attempt: number
): Promise<void> {
  if (!url || !mailerConfigured()) return;
  let recipients: string[] = [];
  try {
    recipients = await institutionAdminEmails(institutionId);
  } catch (err) {
    console.error("recurring: could not load admin emails:", err);
    return;
  }
  const ref = invoiceNumber ? ` ${invoiceNumber}` : "";
  const subject =
    attempt > 0
      ? `Payment reminder: subscription invoice${ref} (attempt ${attempt})`
      : `Your ${env.saasCompanyName} subscription renewal invoice${ref}`;
  const text =
    `Your subscription renewal invoice${ref} for ${currency} ${total} is ready. ` +
    `Please complete the payment using the secure link below:\n\n${url}\n\n` +
    `If you have already paid, please ignore this message.`;
  for (const to of recipients) {
    try {
      await sendMail({ to, subject, text });
    } catch (err) {
      console.error("recurring: renewal link email failed (continuing):", err);
    }
  }
}

/**
 * Generate + issue + payment-link a renewal invoice for one due subscription.
 * The new invoice period is (old renews_at → +one cycle) and is flagged
 * is_renewal so dunning + the webhook can find it. Sets last_charge_at and seeds
 * next_retry_at. Returns true if an invoice was created.
 */
async function generateRenewalFor(sub: DueSub, actor: RecurringActor): Promise<boolean> {
  const cfg = await getResolvedConfig();
  const interval = billingCycleInterval(sub.cycle);
  // Period start = the current renews_at (fall back to ends_at / today); end =
  // +one cycle. Computed in SQL so the interval math matches the webhook.
  const period = await query<{ periodStart: string; periodEnd: string }>(
    `SELECT to_char(base, 'YYYY-MM-DD') AS "periodStart",
            to_char(base + $2::interval, 'YYYY-MM-DD') AS "periodEnd"
     FROM (SELECT COALESCE($1::date, CURRENT_DATE) AS base) s`,
    [sub.renewsAt ?? sub.endsAt ?? null, interval]
  );
  const { periodStart, periodEnd } = period.rows[0];

  // Draft a renewal invoice from the package price (one line). recomputeTotals in
  // the invoice service freezes the totals; issue assigns the FY number.
  const price = await query<{ price: string; name: string; taxPercent: string | null }>(
    `SELECT price::text AS price, name, tax_percent::text AS "taxPercent"
     FROM subscription_packages WHERE id = $1`,
    [sub.packageId]
  );
  const pkg = price.rows[0];
  const unitPrice = pkg ? Number(pkg.price) : 0;
  if (!pkg || unitPrice <= 0) {
    // Nothing sensible to charge — record and skip (no invoice, no state change).
    await platform.recordAudit(
      { id: actor?.id ?? "system", email: actor?.email ?? "system", role: "system", ip: null },
      {
        action: "subscription.renewal_skipped",
        targetType: "subscription",
        targetId: sub.id,
        institutionId: sub.institutionId,
        detail: { reason: "no_package_price" },
      }
    );
    return false;
  }

  const draft = await invoices.createDraft(
    sub.institutionId,
    {
      packageId: sub.packageId ?? undefined,
      periodStart,
      periodEnd,
      currency: sub.currency ?? cfg.currency,
      taxPercent: pkg.taxPercent != null ? Number(pkg.taxPercent) : undefined,
      lines: [{ description: `Subscription renewal — ${pkg.name} (${periodStart} to ${periodEnd})`, unitPrice }],
    },
    actor?.id ?? null // system (worker) runs have no user actor; created_by is nullable
  );

  // Mark it a renewal BEFORE issuing so the webhook/dunning can locate it.
  await query(`UPDATE saas_invoices SET is_renewal = true WHERE id = $1`, [draft.id]);
  const issued = await invoices.issueInvoice(draft.id, actor?.id ?? undefined);

  // Create the hosted payment link (reuses C-4's createPaymentLink).
  let linkUrl: string | null = null;
  try {
    const link = await createPaymentLink(issued.id, actor?.id ?? undefined);
    linkUrl = link.paymentLinkUrl;
  } catch (err) {
    // Link creation failed (e.g. gateway hiccup). The invoice still exists and is
    // issued; dunning will retry the link on the next tick. Record the error.
    const msg = err instanceof Error ? err.message : "payment link failed";
    await query(
      `UPDATE institution_subscriptions SET last_payment_error = $2 WHERE id = $1`,
      [sub.id, msg.slice(0, 500)]
    );
  }

  // Seed the dunning clock: last_charge_at now, first retry one interval out.
  await query(
    `UPDATE institution_subscriptions
        SET last_charge_at = now(),
            next_retry_at = now() + ($2 || ' days')::interval,
            dunning_state = 'none',
            dunning_attempts = 0,
            last_payment_error = COALESCE(last_payment_error, NULL)
      WHERE id = $1`,
    [sub.id, cfg.dunningRetryIntervalDays]
  );

  await platform.recordAudit(
    { id: actor?.id ?? "system", email: actor?.email ?? "system", role: "system", ip: null },
    {
      action: "subscription.renewal_generated",
      targetType: "subscription",
      targetId: sub.id,
      institutionId: sub.institutionId,
      detail: { invoiceId: issued.id, number: issued.number, total: issued.total, periodStart, periodEnd, linked: !!linkUrl },
    }
  );

  await emailRenewalLink(
    sub.institutionId,
    issued.number,
    sub.currency ?? cfg.currency,
    String(issued.total),
    linkUrl,
    0
  );
  return true;
}

/**
 * One recurring + dunning tick. `actor` is null for the automated worker and the
 * super-admin for a manual run. No-op summary (enabled:false) when the gateway
 * master switch is off or the gateway is not configured.
 */
export async function runRecurringBilling(
  actor: RecurringActor = null
): Promise<RecurringSummary> {
  const summary: RecurringSummary = {
    enabled: false,
    renewalsGenerated: 0,
    dunningRetried: 0,
    dunningExhausted: 0,
    suspended: 0,
    ranAt: new Date().toISOString(),
  };

  const cfg = await getResolvedConfig();
  // GRACEFUL DEGRADATION: do nothing (and change nothing) unless recurring is
  // switched on AND the gateway is configured.
  if (!recurringActive(cfg)) return summary;
  summary.enabled = true;

  // 1. RENEWAL GENERATION — active, auto_renew + auto_charge subs whose renews_at
  //    is within the lead window and that have no open (draft/issued) renewal
  //    invoice yet. The open-invoice guard makes re-running the tick idempotent.
  const due = await query<DueSub>(
    `SELECT s.id, s.institution_id AS "institutionId", s.package_id AS "packageId",
            p.billing_cycle AS "cycle",
            to_char(s.renews_at, 'YYYY-MM-DD') AS "renewsAt",
            to_char(s.ends_at, 'YYYY-MM-DD') AS "endsAt",
            i.currency, p.name AS "packageName"
     FROM institution_subscriptions s
     JOIN subscription_packages p ON p.id = s.package_id
     JOIN institutions i ON i.id = s.institution_id
     WHERE s.status = 'active'
       AND s.auto_renew = true
       AND s.auto_charge = true
       AND s.renews_at IS NOT NULL
       AND s.renews_at <= (CURRENT_DATE + $1::int)
       AND NOT EXISTS (
         SELECT 1 FROM saas_invoices ri
         WHERE ri.institution_id = s.institution_id
           AND ri.is_renewal = true
           AND ri.status IN ('draft', 'issued')
       )`,
    [cfg.renewalLeadDays]
  );
  for (const sub of due.rows) {
    try {
      if (await generateRenewalFor(sub, actor)) summary.renewalsGenerated += 1;
    } catch (err) {
      console.error(`recurring: renewal generation failed for ${sub.id}:`, err);
    }
  }

  // 2. DUNNING — subscriptions with an OPEN (issued, unpaid) renewal invoice whose
  //    next_retry_at has passed. Advance one attempt; at the cap, exhaust +
  //    (optionally) suspend. Each subscription is processed in its own tx.
  const overdue = await query<{ id: string; institutionId: string; attempts: number }>(
    `SELECT s.id, s.institution_id AS "institutionId", s.dunning_attempts AS attempts
     FROM institution_subscriptions s
     WHERE s.status = 'active'
       AND s.auto_charge = true
       AND s.dunning_state <> 'exhausted'
       AND s.next_retry_at IS NOT NULL
       AND s.next_retry_at <= now()
       AND EXISTS (
         SELECT 1 FROM saas_invoices ri
         WHERE ri.institution_id = s.institution_id
           AND ri.is_renewal = true
           AND ri.status = 'issued'
       )`
  );
  for (const row of overdue.rows) {
    try {
      const outcome = await runDunningStep(row.id, row.institutionId, cfg);
      if (outcome.result === "retried") {
        summary.dunningRetried += 1;
        // Re-send the payment link OUTSIDE the transaction so an email/gateway
        // hiccup can never roll back the committed state change.
        await resendRenewalLink(row.institutionId, outcome.attempt, actor);
      } else if (outcome.result === "exhausted") {
        summary.dunningExhausted += 1;
        if (outcome.suspended) summary.suspended += 1;
      }
    } catch (err) {
      console.error(`recurring: dunning step failed for ${row.id}:`, err);
    }
  }

  return summary;
}

interface DunningResult {
  result: "retried" | "exhausted" | "noop";
  attempt: number;
  suspended: boolean;
}

/**
 * Advance the dunning clock for one subscription (in its own transaction, with a
 * row lock). Increments the attempt and pushes next_retry_at forward. When the
 * incremented attempt reaches the cap, marks the subscription `exhausted` and (if
 * configured) suspends the institution. Never deletes data. Audited on the
 * transaction client. The retry email/link re-send happens after commit.
 */
async function runDunningStep(
  subscriptionId: string,
  institutionId: string,
  cfg: Awaited<ReturnType<typeof getResolvedConfig>>
): Promise<DunningResult> {
  return withTransaction(async (client) => {
    // Re-read under a row lock so two overlapping ticks can't double-advance.
    const lock = await client.query<{
      attempts: number;
      dunningState: string;
      nextRetryAt: string | null;
      status: string;
    }>(
      `SELECT dunning_attempts AS attempts, dunning_state AS "dunningState",
              next_retry_at AS "nextRetryAt", status
       FROM institution_subscriptions WHERE id = $1 FOR UPDATE`,
      [subscriptionId]
    );
    const s = lock.rows[0];
    const noop: DunningResult = { result: "noop", attempt: 0, suspended: false };
    if (!s) return noop;
    // Guard against a racing tick that already advanced/cleared this row.
    if (
      s.status !== "active" ||
      s.dunningState === "exhausted" ||
      !s.nextRetryAt ||
      new Date(s.nextRetryAt).getTime() > Date.now()
    ) {
      return noop;
    }

    // Confirm the renewal invoice is still open (unpaid) — a webhook may have
    // settled it between the outer scan and this lock.
    const inv = await client.query<{ id: string }>(
      `SELECT id FROM saas_invoices
       WHERE institution_id = $1 AND is_renewal = true AND status = 'issued'
       ORDER BY created_at DESC LIMIT 1`,
      [institutionId]
    );
    if (!inv.rows[0]) return noop;
    const renewalInvoiceId = inv.rows[0].id;

    const attempt = s.attempts + 1;
    const exhausted = attempt >= cfg.dunningMaxAttempts;

    if (!exhausted) {
      await client.query(
        `UPDATE institution_subscriptions
            SET dunning_state = 'retrying',
                dunning_attempts = $2,
                next_retry_at = now() + ($3 || ' days')::interval,
                last_payment_error = 'renewal invoice unpaid'
          WHERE id = $1`,
        [subscriptionId, attempt, cfg.dunningRetryIntervalDays]
      );
      await recordAuditTx(client, {
        action: "subscription.dunning_retry",
        institutionId,
        targetId: subscriptionId,
        detail: { attempt, maxAttempts: cfg.dunningMaxAttempts, invoiceId: renewalInvoiceId },
      });
      await recordSubscriptionEventTx(client, {
        institutionId,
        subscriptionId,
        event: "dunning_retry",
        detail: { attempt, maxAttempts: cfg.dunningMaxAttempts, invoiceId: renewalInvoiceId },
      });
      return { result: "retried", attempt, suspended: false };
    }

    // Exhausted: mark and (optionally) suspend the institution.
    await client.query(
      `UPDATE institution_subscriptions
          SET dunning_state = 'exhausted',
              dunning_attempts = $2,
              next_retry_at = NULL,
              last_payment_error = 'dunning exhausted'
        WHERE id = $1`,
      [subscriptionId, attempt]
    );
    let suspended = false;
    if (cfg.suspendOnDunningExhausted) {
      const susp = await client.query(
        // PR-SEC2 status alignment: keep status in sync with is_active so a
        // billing auto-suspend reads as 'suspended' everywhere, not just inactive.
        `UPDATE institutions SET is_active = false, status = 'suspended' WHERE id = $1 AND is_active = true`,
        [institutionId]
      );
      suspended = (susp.rowCount ?? 0) > 0;
    }
    await recordAuditTx(client, {
      action: "subscription.dunning_exhausted",
      institutionId,
      targetId: subscriptionId,
      detail: { attempts: attempt, suspended, invoiceId: renewalInvoiceId },
    });
    await recordSubscriptionEventTx(client, {
      institutionId,
      subscriptionId,
      event: "dunning_exhausted",
      detail: { attempts: attempt, suspended, invoiceId: renewalInvoiceId },
    });
    return { result: "exhausted", attempt, suspended };
  });
}

/**
 * Reuse/create the hosted payment link for the open renewal invoice and email it
 * as a dunning reminder. Best-effort and non-transactional: a failure here never
 * rolls back the committed dunning state.
 */
async function resendRenewalLink(
  institutionId: string,
  attempt: number,
  _actor: RecurringActor
): Promise<void> {
  try {
    const { rows } = await query<{ id: string; number: string | null; total: string; currency: string }>(
      `SELECT id, number, total::text AS total, currency
       FROM saas_invoices
       WHERE institution_id = $1 AND is_renewal = true AND status = 'issued'
       ORDER BY created_at DESC LIMIT 1`,
      [institutionId]
    );
    const inv = rows[0];
    if (!inv) return;
    // createPaymentLink reuses an open link if one exists (idempotent).
    const link = await createPaymentLink(inv.id, _actor?.id ?? undefined);
    await emailRenewalLink(institutionId, inv.number, inv.currency, inv.total, link.paymentLinkUrl, attempt);
  } catch (err) {
    console.error("recurring: resend renewal link failed (continuing):", err);
  }
}

/** Toggle per-subscription auto-charge (enrol/withdraw from recurring billing). */
export async function setAutoCharge(
  institutionId: string,
  autoCharge: boolean,
  actor: { id: string; email: string; role: string; ip: string | null }
): Promise<{ subscriptionId: string; autoCharge: boolean }> {
  const { rows } = await query<{ id: string }>(
    `UPDATE institution_subscriptions
        SET auto_charge = $2
      WHERE id = (
        SELECT id FROM institution_subscriptions
        WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 1
      )
      RETURNING id`,
    [institutionId, autoCharge]
  );
  if (!rows[0]) {
    const { ApiError } = await import("../../utils/api-error");
    throw ApiError.notFound("No subscription to update for this institution");
  }
  await platform.recordAudit(actor, {
    action: "subscription.auto_charge_changed",
    targetType: "subscription",
    targetId: rows[0].id,
    institutionId,
    detail: { autoCharge },
  });
  return { subscriptionId: rows[0].id, autoCharge };
}
