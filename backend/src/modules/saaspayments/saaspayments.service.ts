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
  }>(
    `SELECT provider, enabled, key_id AS "keyId", key_secret AS "keySecret",
            webhook_secret AS "webhookSecret", default_currency AS "defaultCurrency"
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
  };
}

/** Show only the last 4 chars of a secret (never the full value or its length). */
function mask(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
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
  }>(
    `SELECT provider, enabled, key_id AS "keyId", key_secret AS "keySecret",
            webhook_secret AS "webhookSecret", default_currency AS "defaultCurrency",
            updated_at AS "updatedAt"
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
    configured: !!r.enabled && !!keyId && !!keySecret,
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
    }>(
      `SELECT id, institution_id AS "institutionId", status, total, currency, number
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
    if (inv.status === "issued") {
      await client.query(
        `UPDATE saas_invoices
           SET status = 'paid', payment_method = $2, payment_reference = $3, paid_at = now()
         WHERE id = $1`,
        [inv.id, provider, evt.gatewayPaymentId ?? evt.gatewayOrderId]
      );
      marked = true;
    }
    return { ok: true, invoiceId: inv.id, transactionId: txnId, marked };
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
