import crypto from "node:crypto";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { env } from "../../config/env";
import type { z } from "zod";
import type { gatewaySettingsSchema, transactionsQuerySchema } from "./saaspayments.schema";

/**
 * Razorpay payment gateway for platform SaaS invoices (Super Admin C-4).
 *
 * - Config lives in a singleton DB row (saas_payment_gateway_settings). Secrets
 *   (key_secret / webhook_secret) are NEVER returned raw — getGatewaySettings()
 *   returns only masked previews + "is set" flags. Env vars provide an optional
 *   fallback for the secrets so operators can configure via env instead.
 * - Online payment is a hosted Razorpay Payment Link (we never see card/UPI data;
 *   we keep only the non-sensitive link/payment ids).
 * - Inbound webhooks are HMAC-SHA256 verified against the webhook secret and made
 *   idempotent via the (provider, event_id) ledger before they can mark an invoice
 *   paid. An unverifiable event is rejected; a duplicate is a no-op.
 * - This is entirely separate from the tenant-side student-fee gateway.
 */

interface ResolvedConfig {
  provider: string;
  enabled: boolean;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  currency: string;
  // B4 recurring/dunning policy (mirrors the singleton settings row).
  autoChargeEnabled: boolean;
  dunningMaxAttempts: number;
  dunningRetryIntervalDays: number;
  suspendOnDunningExhausted: boolean;
  renewalLeadDays: number;
}

/** Is the gateway usable for online charging (enabled + key id + secret set)? */
export function configReady(cfg: ResolvedConfig): boolean {
  return cfg.enabled && !!cfg.keyId && !!cfg.keySecret;
}

/** Is recurring auto-charge fully switched on (master flag + configured gateway)? */
export function recurringActive(cfg: ResolvedConfig): boolean {
  return cfg.autoChargeEnabled && configReady(cfg);
}

/** Effective config exposed to the recurring/dunning worker (internal). */
export async function getResolvedConfig(): Promise<ResolvedConfig> {
  return resolveConfig();
}

async function ensureRow(): Promise<void> {
  await query(
    `INSERT INTO saas_payment_gateway_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`
  );
}

/** Effective config (DB row, with env fallback for the secrets). Internal only. */
async function resolveConfig(): Promise<ResolvedConfig> {
  const { rows } = await query<{
    provider: string;
    enabled: boolean;
    keyId: string | null;
    keySecret: string | null;
    webhookSecret: string | null;
    defaultCurrency: string;
    autoChargeEnabled: boolean;
    dunningMaxAttempts: number;
    dunningRetryIntervalDays: number;
    suspendOnDunningExhausted: boolean;
    renewalLeadDays: number;
  }>(
    `SELECT provider, enabled, key_id AS "keyId", key_secret AS "keySecret",
            webhook_secret AS "webhookSecret", default_currency AS "defaultCurrency",
            auto_charge_enabled AS "autoChargeEnabled",
            dunning_max_attempts AS "dunningMaxAttempts",
            dunning_retry_interval_days AS "dunningRetryIntervalDays",
            suspend_on_dunning_exhausted AS "suspendOnDunningExhausted",
            renewal_lead_days AS "renewalLeadDays"
     FROM saas_payment_gateway_settings WHERE id = TRUE`
  );
  const r = rows[0];
  return {
    provider: r?.provider || "razorpay",
    enabled: !!r?.enabled,
    keyId: r?.keyId || env.razorpayKeyId || null,
    keySecret: r?.keySecret || env.razorpayKeySecret || null,
    webhookSecret: r?.webhookSecret || env.razorpayWebhookSecret || null,
    currency: r?.defaultCurrency || env.paymentCurrency || "INR",
    autoChargeEnabled: !!r?.autoChargeEnabled,
    dunningMaxAttempts: r?.dunningMaxAttempts ?? 3,
    dunningRetryIntervalDays: r?.dunningRetryIntervalDays ?? 3,
    suspendOnDunningExhausted: r?.suspendOnDunningExhausted ?? true,
    renewalLeadDays: r?.renewalLeadDays ?? 0,
  };
}

/** Show only the last 4 chars of a secret (never the full value or its length). */
function mask(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

// --- Recurring/dunning shared helpers (B4) ---------------------------------

/**
 * Map a package billing cycle to a Postgres interval string. Unknown/absent
 * cycles fall back to one month (the safe default) so a renewal never rolls the
 * period by zero. Used to advance renews_at/ends_at by exactly one cycle.
 */
export function billingCycleInterval(cycle: string | null | undefined): string {
  switch ((cycle ?? "").toLowerCase()) {
    case "annual":
    case "yearly":
    case "year":
      return "1 year";
    case "half_yearly":
    case "semi_annual":
    case "biannual":
      return "6 months";
    case "quarterly":
    case "quarter":
      return "3 months";
    case "weekly":
    case "week":
      return "1 week";
    case "monthly":
    case "month":
    default:
      return "1 month";
  }
}

interface AuditTxInput {
  action: string;
  institutionId: string | null;
  targetId: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Append a platform_audit_log row on a transaction client (system actor —
 * actor_id NULL). Kept on the passed client so it commits/rolls back with the
 * enclosing transaction and never self-deadlocks against a FOR UPDATE lock.
 * Best-effort: never throws into the caller.
 */
export async function recordAuditTx(client: TxClient, input: AuditTxInput): Promise<void> {
  try {
    await client.query(
      `INSERT INTO platform_audit_log
         (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
       VALUES ($1,'subscription',$2,$3,NULL,'system','system',$4::jsonb,NULL)`,
      [input.action, input.targetId, input.institutionId, JSON.stringify(input.detail ?? {})]
    );
  } catch (err) {
    console.error(`recordAuditTx ${input.action} failed (continuing):`, err);
  }
}

interface SubEventTxInput {
  institutionId: string;
  subscriptionId: string | null;
  event: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  detail?: Record<string, unknown>;
}

/** Append a subscription_events row on a transaction client. Best-effort. */
export async function recordSubscriptionEventTx(
  client: TxClient,
  input: SubEventTxInput
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO subscription_events
         (institution_id, subscription_id, event, from_status, to_status,
          actor_id, actor_email, detail)
       VALUES ($1,$2,$3,$4,$5,NULL,'system',$6::jsonb)`,
      [
        input.institutionId,
        input.subscriptionId,
        input.event,
        input.fromStatus ?? null,
        input.toStatus ?? null,
        JSON.stringify(input.detail ?? {}),
      ]
    );
  } catch (err) {
    console.error(`recordSubscriptionEventTx ${input.event} failed (continuing):`, err);
  }
}

export interface GatewaySettingsView {
  provider: string;
  enabled: boolean;
  keyId: string | null;
  defaultCurrency: string;
  updatedAt: string | null;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  keySecretMasked: string | null;
  webhookSecretMasked: string | null;
  keySecretSource: "db" | "env" | null;
  webhookSecretSource: "db" | "env" | null;
  configured: boolean;
  // B4 recurring & dunning policy (off by default; recurringActive = master
  // switch ON *and* the gateway configured).
  autoChargeEnabled: boolean;
  dunningMaxAttempts: number;
  dunningRetryIntervalDays: number;
  suspendOnDunningExhausted: boolean;
  renewalLeadDays: number;
  recurringActive: boolean;
}

/** Safe-to-expose settings view — secrets are masked, never returned raw. */
export async function getGatewaySettings(): Promise<GatewaySettingsView> {
  const { rows } = await query<{
    provider: string;
    enabled: boolean;
    keyId: string | null;
    keySecret: string | null;
    webhookSecret: string | null;
    defaultCurrency: string;
    updatedAt: string;
    autoChargeEnabled: boolean;
    dunningMaxAttempts: number;
    dunningRetryIntervalDays: number;
    suspendOnDunningExhausted: boolean;
    renewalLeadDays: number;
  }>(
    `SELECT provider, enabled, key_id AS "keyId", key_secret AS "keySecret",
            webhook_secret AS "webhookSecret", default_currency AS "defaultCurrency",
            updated_at AS "updatedAt",
            auto_charge_enabled AS "autoChargeEnabled",
            dunning_max_attempts AS "dunningMaxAttempts",
            dunning_retry_interval_days AS "dunningRetryIntervalDays",
            suspend_on_dunning_exhausted AS "suspendOnDunningExhausted",
            renewal_lead_days AS "renewalLeadDays"
     FROM saas_payment_gateway_settings WHERE id = TRUE`
  );
  if (!rows[0]) {
    await ensureRow();
    return getGatewaySettings();
  }
  const r = rows[0];
  const keyId = r.keyId || env.razorpayKeyId || null;
  const keySecret = r.keySecret || env.razorpayKeySecret || null;
  const webhookSecret = r.webhookSecret || env.razorpayWebhookSecret || null;
  const configured = !!r.enabled && !!keyId && !!keySecret;
  return {
    provider: r.provider,
    enabled: !!r.enabled,
    keyId,
    defaultCurrency: r.defaultCurrency,
    updatedAt: r.updatedAt,
    keySecretSet: !!keySecret,
    webhookSecretSet: !!webhookSecret,
    keySecretMasked: mask(keySecret),
    webhookSecretMasked: mask(webhookSecret),
    keySecretSource: r.keySecret ? "db" : env.razorpayKeySecret ? "env" : null,
    webhookSecretSource: r.webhookSecret ? "db" : env.razorpayWebhookSecret ? "env" : null,
    configured,
    autoChargeEnabled: !!r.autoChargeEnabled,
    dunningMaxAttempts: r.dunningMaxAttempts,
    dunningRetryIntervalDays: r.dunningRetryIntervalDays,
    suspendOnDunningExhausted: r.suspendOnDunningExhausted,
    renewalLeadDays: r.renewalLeadDays,
    recurringActive: !!r.autoChargeEnabled && configured,
  };
}

export async function updateGatewaySettings(
  input: z.infer<typeof gatewaySettingsSchema>,
  actorId: string
): Promise<GatewaySettingsView> {
  await ensureRow();
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.provider !== undefined) add("provider", input.provider);
  if (input.enabled !== undefined) add("enabled", input.enabled);
  if (input.keyId !== undefined) add("key_id", input.keyId || null);
  if (input.defaultCurrency !== undefined) add("default_currency", input.defaultCurrency);
  // B4 recurring & dunning policy.
  if (input.autoChargeEnabled !== undefined) add("auto_charge_enabled", input.autoChargeEnabled);
  if (input.dunningMaxAttempts !== undefined) add("dunning_max_attempts", input.dunningMaxAttempts);
  if (input.dunningRetryIntervalDays !== undefined)
    add("dunning_retry_interval_days", input.dunningRetryIntervalDays);
  if (input.suspendOnDunningExhausted !== undefined)
    add("suspend_on_dunning_exhausted", input.suspendOnDunningExhausted);
  if (input.renewalLeadDays !== undefined) add("renewal_lead_days", input.renewalLeadDays);
  // Secrets are write-only: only overwrite when a non-empty value is supplied, so
  // saving the masked form without re-typing them preserves the stored secrets.
  if (typeof input.keySecret === "string" && input.keySecret.trim() !== "")
    add("key_secret", input.keySecret.trim());
  if (typeof input.webhookSecret === "string" && input.webhookSecret.trim() !== "")
    add("webhook_secret", input.webhookSecret.trim());
  if (sets.length) {
    params.push(actorId);
    sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
    await query(
      `UPDATE saas_payment_gateway_settings SET ${sets.join(", ")} WHERE id = TRUE`,
      params
    );
  }
  return getGatewaySettings();
}

// --- Razorpay REST helpers -------------------------------------------------

/** HMAC-SHA256 hex of the raw body (exposed for tooling/tests that send webhooks). */
export function signPayload(rawBody: string | Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function verifySignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string
): boolean {
  if (!rawBody || !signature) return false;
  const expected = signPayload(rawBody, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function razorpayCreatePaymentLink(
  cfg: ResolvedConfig,
  payload: Record<string, unknown>
): Promise<{ id: string | null; short_url: string | null }> {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${env.razorpayApiBase}/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(502, "Could not reach the payment gateway");
  }
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    short_url?: string;
    error?: { description?: string };
  };
  if (!res.ok) {
    throw new ApiError(502, data?.error?.description || `Payment gateway error (${res.status})`);
  }
  return { id: data.id ?? null, short_url: data.short_url ?? null };
}

// --- Payment link creation -------------------------------------------------

export interface PaymentLinkResult {
  transactionId: string;
  paymentLinkUrl: string | null;
  gatewayOrderId: string | null;
  status: string;
  reused?: boolean;
}

export async function createPaymentLink(
  invoiceId: string,
  createdBy?: string
): Promise<PaymentLinkResult> {
  const cfg = await resolveConfig();
  if (!cfg.enabled) throw ApiError.badRequest("Payment gateway is not enabled");
  if (!cfg.keyId || !cfg.keySecret)
    throw ApiError.badRequest("Payment gateway is not fully configured (missing key id / secret)");

  const { rows } = await query<{
    id: string;
    institutionId: string;
    status: string;
    total: string;
    currency: string;
    number: string | null;
  }>(
    `SELECT id, institution_id AS "institutionId", status, total, currency, number
     FROM saas_invoices WHERE id = $1`,
    [invoiceId]
  );
  const inv = rows[0];
  if (!inv) throw ApiError.notFound("Invoice not found");
  if (inv.status === "paid") throw ApiError.badRequest("Invoice is already paid");
  if (inv.status !== "issued")
    throw ApiError.badRequest("Only an issued invoice can be paid online");

  // Reuse an existing open link so we don't create duplicates (and so Razorpay's
  // unique reference_id is not violated).
  const open = await query<{
    id: string;
    paymentLinkUrl: string | null;
    gatewayOrderId: string | null;
  }>(
    `SELECT id, payment_link_url AS "paymentLinkUrl", gateway_order_id AS "gatewayOrderId"
     FROM saas_payment_transactions
     WHERE invoice_id = $1 AND status IN ('created', 'pending') AND payment_link_url IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [invoiceId]
  );
  if (open.rows[0]) {
    return {
      transactionId: open.rows[0].id,
      paymentLinkUrl: open.rows[0].paymentLinkUrl,
      gatewayOrderId: open.rows[0].gatewayOrderId,
      status: "pending",
      reused: true,
    };
  }

  const amountPaise = Math.round(Number(inv.total) * 100);
  if (amountPaise <= 0) throw ApiError.badRequest("Invoice total must be greater than zero");
  const currency = inv.currency || cfg.currency || "INR";
  const reference = inv.number || inv.id;
  const link = await razorpayCreatePaymentLink(cfg, {
    amount: amountPaise,
    currency,
    accept_partial: false,
    reference_id: reference,
    description: `Payment for invoice ${reference}`,
    notes: { invoice_id: inv.id, invoice_number: inv.number ?? "" },
    notify: { sms: false, email: false },
    reminder_enable: false,
  });

  const ins = await query<{ id: string }>(
    `INSERT INTO saas_payment_transactions
       (invoice_id, institution_id, provider, gateway_order_id, gateway_reference,
        amount, currency, status, payment_link_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING id`,
    [inv.id, inv.institutionId, cfg.provider, link.id, reference, inv.total, currency, link.short_url, createdBy ?? null]
  );
  return {
    transactionId: ins.rows[0].id,
    paymentLinkUrl: link.short_url,
    gatewayOrderId: link.id,
    status: "pending",
  };
}

// --- Webhook processing ----------------------------------------------------

interface ParsedEvent {
  eventType: string;
  status: "paid" | "failed" | "cancelled" | null;
  invoiceId: string | null;
  reference: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amount: number | null;
}

function parseRazorpayEvent(body: unknown): ParsedEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  const event = typeof b.event === "string" ? b.event : "";
  const payload = (b.payload ?? {}) as Record<string, any>;
  const plink = payload.payment_link?.entity ?? null;
  const payment = payload.payment?.entity ?? null;
  const order = payload.order?.entity ?? null;
  const notes = plink?.notes ?? payment?.notes ?? order?.notes ?? {};
  const invoiceId =
    typeof notes?.invoice_id === "string" && notes.invoice_id ? notes.invoice_id : null;
  const reference = plink?.reference_id ?? null;
  const gatewayOrderId = plink?.id ?? order?.id ?? payment?.order_id ?? null;
  const gatewayPaymentId = payment?.id ?? null;
  const amountPaise = payment?.amount ?? plink?.amount ?? order?.amount ?? null;
  const amount = amountPaise != null ? Number(amountPaise) / 100 : null;
  const paidEvents = ["payment_link.paid", "payment.captured", "order.paid"];
  const status: ParsedEvent["status"] = paidEvents.includes(event)
    ? "paid"
    : event === "payment.failed"
      ? "failed"
      : event.includes("cancelled")
        ? "cancelled"
        : null;
  return { eventType: event, status, invoiceId, reference, gatewayOrderId, gatewayPaymentId, amount };
}

export interface WebhookResult {
  ok: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  reason?: string;
  invoiceId?: string;
  transactionId?: string;
  marked?: boolean;
  renewed?: boolean;
}

// A minimal transaction-client shape (both `query()` overload signatures) so the
// renewal-settlement helper can be reused from the webhook and the worker without
// importing pg's PoolClient type directly.
export type TxClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

/**
 * A paid renewal invoice advances the subscription by one billing cycle: set it
 * `active`, roll `renews_at`/`ends_at` forward one cycle from the current
 * `renews_at` (falling back to `ends_at`/today), clear dunning, and reactivate
 * the institution if it was suspended by dunning. Everything runs on the passed
 * transaction client. Idempotent: the caller only invokes this the first time an
 * issued renewal invoice flips to paid. Audited to platform_audit_log +
 * subscription_events on the same client. Returns whether a subscription moved.
 */
async function settleRenewalOnPaid(
  client: TxClient,
  invoiceId: string,
  institutionId: string,
  provider: string
): Promise<boolean> {
  // Lock the institution's latest subscription row. FOR UPDATE cannot be applied
  // to the nullable side of an outer join, so lock the base row alone and read the
  // package billing cycle in a second (non-locking) query.
  const subRes = await client.query<{
    id: string;
    status: string;
    fromStatus: string;
    dunningState: string;
    packageId: string | null;
  }>(
    `SELECT id, status, status AS "fromStatus", dunning_state AS "dunningState",
            package_id AS "packageId"
     FROM institution_subscriptions
     WHERE institution_id = $1
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [institutionId]
  );
  const sub = subRes.rows[0];
  if (!sub) return false;

  let cycle: string | null = null;
  if (sub.packageId) {
    const pkg = await client.query<{ cycle: string | null }>(
      `SELECT billing_cycle AS "cycle" FROM subscription_packages WHERE id = $1`,
      [sub.packageId]
    );
    cycle = pkg.rows[0]?.cycle ?? null;
  }
  const interval = billingCycleInterval(cycle);
  const upd = await client.query<{ id: string; renewsAt: string | null; endsAt: string | null }>(
    `UPDATE institution_subscriptions
        SET status = 'active',
            renews_at = COALESCE(renews_at, ends_at, CURRENT_DATE) + $2::interval,
            ends_at = COALESCE(renews_at, ends_at, CURRENT_DATE) + $2::interval,
            grace_until = NULL,
            dunning_state = 'none',
            dunning_attempts = 0,
            next_retry_at = NULL,
            last_payment_error = NULL,
            last_charge_at = now()
      WHERE id = $1
      RETURNING id, to_char(renews_at, 'YYYY-MM-DD') AS "renewsAt",
                to_char(ends_at, 'YYYY-MM-DD') AS "endsAt"`,
    [sub.id, interval]
  );
  const row = upd.rows[0];

  // Reactivate an institution only if it was suspended AS PART OF dunning — never
  // silently un-suspend a tenant an operator suspended for another reason.
  let reactivated = false;
  if (sub.dunningState === "exhausted") {
    const react = await client.query(
      // PR-SEC2 status alignment: renewal-reactivation clears the suspended status
      // it set on dunning-exhaust, so status never lags is_active (no new trigger).
      `UPDATE institutions SET is_active = true, status = 'active' WHERE id = $1 AND is_active = false`,
      [institutionId]
    );
    reactivated = (react.rowCount ?? 0) > 0;
  }

  await recordAuditTx(client, {
    action: "subscription.renewed",
    institutionId,
    targetId: sub.id,
    detail: {
      invoiceId,
      provider,
      renewsAt: row?.renewsAt ?? null,
      endsAt: row?.endsAt ?? null,
      reactivated,
      fromStatus: sub.fromStatus,
    },
  });
  await recordSubscriptionEventTx(client, {
    institutionId,
    subscriptionId: sub.id,
    event: "renewed",
    fromStatus: sub.fromStatus,
    toStatus: "active",
    detail: { invoiceId, renewsAt: row?.renewsAt ?? null, reactivated },
  });
  return true;
}

export async function processWebhook(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  eventIdHeader: string | undefined,
  body: unknown
): Promise<WebhookResult> {
  const cfg = await resolveConfig();
  if (!cfg.webhookSecret) {
    // Never trust an event we cannot verify.
    throw ApiError.serviceUnavailable("Payment gateway webhook secret is not configured");
  }
  if (!verifySignature(rawBody, signature, cfg.webhookSecret)) {
    throw ApiError.unauthorized("Invalid webhook signature");
  }
  const provider = cfg.provider || "razorpay";
  const evt = parseRazorpayEvent(body);
  const eventType = evt?.eventType ?? null;
  // Razorpay sends a per-delivery event id header; fall back to a body hash.
  const eventId =
    (eventIdHeader && eventIdHeader.trim()) ||
    crypto.createHash("sha256").update(rawBody ?? Buffer.from("")).digest("hex");

  return withTransaction(async (client) => {
    // Idempotency + processing commit/rollback together.
    const ins = await client.query<{ id: string }>(
      `INSERT INTO saas_payment_webhook_events (provider, event_id, event_type, status)
       VALUES ($1,$2,$3,$4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [provider, eventId, eventType, evt?.status ?? "ignored"]
    );
    if (!ins.rows[0]) return { ok: true, duplicate: true };
    const eventRowId = ins.rows[0].id;

    if (!evt || evt.status !== "paid") return { ok: true, ignored: true };

    // Resolve the invoice from notes.invoice_id, else the reference_id (= number).
    let invId = evt.invoiceId;
    if (!invId && evt.reference) {
      const byRef = await client.query<{ id: string }>(
        `SELECT id FROM saas_invoices WHERE number = $1`,
        [evt.reference]
      );
      invId = byRef.rows[0]?.id ?? null;
    }
    if (!invId) return { ok: true, ignored: true, reason: "invoice_not_found" };

    const invRes = await client.query<{
      id: string;
      institutionId: string;
      status: string;
      total: string;
      currency: string;
      number: string | null;
      isRenewal: boolean;
    }>(
      `SELECT id, institution_id AS "institutionId", status, total, currency, number,
              is_renewal AS "isRenewal"
       FROM saas_invoices WHERE id = $1`,
      [invId]
    );
    const inv = invRes.rows[0];
    if (!inv) return { ok: true, ignored: true, reason: "invoice_not_found" };

    // Find the transaction to settle (by gateway order id, else the latest open
    // one for this invoice), else create a fresh paid row.
    let txnId: string | undefined;
    if (evt.gatewayOrderId) {
      const found = await client.query<{ id: string }>(
        `SELECT id FROM saas_payment_transactions WHERE provider = $1 AND gateway_order_id = $2`,
        [provider, evt.gatewayOrderId]
      );
      txnId = found.rows[0]?.id;
    }
    if (!txnId) {
      const openTxn = await client.query<{ id: string }>(
        `SELECT id FROM saas_payment_transactions
         WHERE invoice_id = $1 AND status IN ('created', 'pending')
         ORDER BY created_at DESC LIMIT 1`,
        [inv.id]
      );
      txnId = openTxn.rows[0]?.id;
    }
    if (txnId) {
      await client.query(
        `UPDATE saas_payment_transactions
           SET status = 'paid', gateway_payment_id = $2,
               gateway_order_id = COALESCE(gateway_order_id, $3), updated_at = now()
         WHERE id = $1`,
        [txnId, evt.gatewayPaymentId, evt.gatewayOrderId]
      );
    } else {
      const insTxn = await client.query<{ id: string }>(
        `INSERT INTO saas_payment_transactions
           (invoice_id, institution_id, provider, gateway_order_id, gateway_payment_id,
            gateway_reference, amount, currency, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid') RETURNING id`,
        [inv.id, inv.institutionId, provider, evt.gatewayOrderId, evt.gatewayPaymentId, inv.number, evt.amount ?? inv.total, inv.currency]
      );
      txnId = insTxn.rows[0].id;
    }

    await client.query(
      `UPDATE saas_payment_webhook_events SET transaction_id = $2 WHERE id = $1`,
      [eventRowId, txnId]
    );

    // Mark the invoice paid only if it is still issued (idempotent + safe).
    let marked = false;
    let renewed = false;
    if (inv.status === "issued") {
      await client.query(
        `UPDATE saas_invoices
           SET status = 'paid', payment_method = $2, payment_reference = $3, paid_at = now()
         WHERE id = $1`,
        [inv.id, provider, evt.gatewayPaymentId ?? evt.gatewayOrderId]
      );
      marked = true;
      // B4: settling a RENEWAL invoice extends the subscription and clears any
      // dunning (and reactivates a dunning-suspended tenant). All writes ride on
      // the transaction client so they commit/rollback with the ledger insert —
      // never the pool (which would self-deadlock against the FOR UPDATE lock).
      if (inv.isRenewal) {
        renewed = await settleRenewalOnPaid(client, inv.id, inv.institutionId, provider);
      }
    }
    return { ok: true, invoiceId: inv.id, transactionId: txnId, marked, renewed };
  });
}

// --- Transactions list / report -------------------------------------------

export const TXN_COLUMNS = [
  { key: "createdAt", label: "Date" },
  { key: "invoiceNumber", label: "Invoice" },
  { key: "institutionName", label: "Institution" },
  { key: "provider", label: "Provider" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "currency", label: "Currency" },
  { key: "gatewayOrderId", label: "Gateway link/order id" },
  { key: "gatewayPaymentId", label: "Gateway payment id" },
  { key: "paymentLinkUrl", label: "Payment link" },
];

export async function listTransactions(q: z.infer<typeof transactionsQuerySchema>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, val: unknown) => {
    params.push(val);
    where.push(sql.replace("$$", `$${params.length}`));
  };
  if (q.invoiceId) add("t.invoice_id = $$", q.invoiceId);
  if (q.institutionId) add("t.institution_id = $$", q.institutionId);
  if (q.status) add("t.status = $$", q.status);
  if (q.from) add("t.created_at >= $$", q.from);
  if (q.to) add("t.created_at < ($$::date + 1)", q.to);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = (
    await query(
      `SELECT t.id, to_char(t.created_at, 'YYYY-MM-DD') AS "createdAt",
              i.number AS "invoiceNumber", inst.name AS "institutionName",
              t.provider, t.status, t.amount, t.currency,
              t.gateway_order_id AS "gatewayOrderId", t.gateway_payment_id AS "gatewayPaymentId",
              t.payment_link_url AS "paymentLinkUrl", t.invoice_id AS "invoiceId"
       FROM saas_payment_transactions t
       JOIN saas_invoices i ON i.id = t.invoice_id
       JOIN institutions inst ON inst.id = t.institution_id
       ${whereSql} ORDER BY t.created_at DESC LIMIT 5000`,
      params
    )
  ).rows;
  const totals = (
    await query(
      `SELECT count(*)::int AS count,
              coalesce(sum(t.amount), 0)::text AS amount,
              coalesce(sum(t.amount) FILTER (WHERE t.status = 'paid'), 0)::text AS "paidAmount"
       FROM saas_payment_transactions t ${whereSql}`,
      params
    )
  ).rows[0];
  return { columns: TXN_COLUMNS, rows, totals };
}
