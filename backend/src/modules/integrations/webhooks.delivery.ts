import { createHmac } from "node:crypto";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { logError } from "../../utils/logger";
import { enqueue } from "../jobs/jobs.service";

// Outbound delivery for registered webhook endpoints. The HMAC signature lets
// receivers verify a payload genuinely came from us (and was not tampered with):
//   X-Sreedo-Signature: sha256=<hex hmac of the raw body, keyed by the endpoint secret>
// Delivery is fire-and-forget via the Postgres job queue (retried with backoff);
// the "test" path delivers synchronously so the admin gets an immediate result.

const DELIVERY_TIMEOUT_MS = 10_000;
const SIGNATURE_HEADER = "X-Sreedo-Signature";
const EVENT_HEADER = "X-Sreedo-Event";

interface DeliverableWebhook {
  id: string;
  url: string;
  secret: string;
  institutionId: string;
}

export interface DeliveryResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
}

/** HMAC-SHA256 of the raw body, keyed by the endpoint secret (GitHub-style). */
export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Loads a webhook with its signing secret (internal use only — the secret is
 *  never returned by the public API). `requireActive` is true for queued real
 *  events (skip paused endpoints) and false for the manual test button. */
async function loadWebhook(
  id: string,
  institutionId: string,
  requireActive: boolean
): Promise<DeliverableWebhook | null> {
  const activeClause = requireActive ? " AND is_active = true" : "";
  const { rows } = await query<DeliverableWebhook>(
    `SELECT id, url, secret, institution_id AS "institutionId"
     FROM webhook_endpoints WHERE id = $1 AND institution_id = $2${activeClause}`,
    [id, institutionId]
  );
  return rows[0] ?? null;
}

/** POSTs one signed event and records a delivery-log row. Never throws on a
 *  delivery failure — returns the outcome so the caller decides whether to retry. */
async function deliverOnce(
  wh: DeliverableWebhook,
  eventType: string,
  data: unknown,
  attempt: number
): Promise<DeliveryResult> {
  const body = JSON.stringify({
    event: eventType,
    data,
    timestamp: new Date().toISOString(),
  });
  let statusCode: number | null = null;
  let ok = false;
  let error: string | null = null;
  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "SREEDO-Webhooks/1",
        [EVENT_HEADER]: eventType,
        [SIGNATURE_HEADER]: signBody(wh.secret, body),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    statusCode = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "delivery failed";
  }
  await query(
    `INSERT INTO webhook_deliveries
       (institution_id, webhook_id, event_type, status_code, success, error, attempt)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [wh.institutionId, wh.id, eventType, statusCode, ok, error, attempt]
  );
  return { success: ok, statusCode, error };
}

function eventMatches(filter: string | null, eventType: string): boolean {
  const f = (filter ?? "*").trim();
  if (f === "*" || f === "") return true;
  return f
    .split(",")
    .map((s) => s.trim())
    .includes(eventType);
}

/**
 * Fan-out an institution domain event to every matching active webhook by
 * enqueuing a delivery job each. Best-effort: this is called from request paths
 * (e.g. after creating a student) so it NEVER throws into the caller — failures
 * are logged and swallowed.
 */
export async function dispatchEvent(
  institutionId: string,
  eventType: string,
  data: unknown
): Promise<void> {
  try {
    const { rows } = await query<{ id: string; eventTypes: string | null }>(
      `SELECT id, event_types AS "eventTypes" FROM webhook_endpoints
       WHERE institution_id = $1 AND is_active = true`,
      [institutionId]
    );
    for (const w of rows) {
      if (!eventMatches(w.eventTypes, eventType)) continue;
      await enqueue({
        type: "webhook_deliver",
        payload: { webhookId: w.id, eventType, data },
        institutionId,
        maxAttempts: 5,
      });
    }
  } catch (err) {
    logError("webhook dispatch failed", err, { eventType });
  }
}

/** Job handler body (`webhook_deliver`): deliver one queued event, throwing on
 *  failure so the queue retries with its backoff. A webhook deleted or paused
 *  since enqueue is a quiet no-op success. */
export async function runWebhookDeliveryJob(
  payload: Record<string, unknown>,
  institutionId: string | null,
  attempt: number
): Promise<void> {
  const webhookId = typeof payload.webhookId === "string" ? payload.webhookId : null;
  const eventType = typeof payload.eventType === "string" ? payload.eventType : "unknown";
  if (!webhookId || !institutionId) {
    throw new Error("webhook_deliver requires webhookId and institution");
  }
  const wh = await loadWebhook(webhookId, institutionId, true);
  if (!wh) return;
  const result = await deliverOnce(wh, eventType, payload.data, attempt);
  if (!result.success) throw new Error(result.error ?? "webhook delivery failed");
}

/** Synchronous test delivery for the UI "Test" button: delivers immediately and
 *  returns the outcome (no retry). Works on paused endpoints too. */
export async function sendTestEvent(
  webhookId: string,
  institutionId: string
): Promise<DeliveryResult> {
  const wh = await loadWebhook(webhookId, institutionId, false);
  if (!wh) throw ApiError.notFound("Webhook not found");
  return deliverOnce(wh, "ping", { message: "Test event from SRE EDU OS." }, 0);
}
