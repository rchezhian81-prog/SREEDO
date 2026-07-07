import { query } from "../db/postgres";
import { deliverMail } from "./mailer";
import { maskFreeText } from "../modules/platform/audit.service";

/**
 * Communication Admin (Super Admin O) — send-and-log helper.
 *
 * A NEW, additive wrapper around the shared `deliverMail` (whose signature and
 * existing callers are untouched): it delivers an email and records ONE row in
 * the unified `email_deliveries` log with the outcome + safe metadata. It is used
 * by the platform test-send, broadcast worker and delivery-retry paths.
 *
 * Hard guarantees:
 *   • It NEVER throws out of a send — a logging failure is swallowed (best-effort),
 *     so it can never break the originating request or a job.
 *   • It stores metadata + subject ONLY, never the rendered body, and never a
 *     secret/token/reset-link — `failure_reason` / `provider_response` are masked.
 */

export type TriggerSource =
  | "invoice"
  | "subscription"
  | "support"
  | "security"
  | "backup"
  | "export"
  | "platform_admin"
  | "manual_test"
  | "broadcast"
  | "system";

export interface DeliverAndLogMeta {
  templateKey?: string | null;
  category?: string | null;
  recipientName?: string | null;
  institutionId?: string | null;
  triggerSource?: TriggerSource;
  relatedType?: string | null;
  relatedId?: string | null;
  broadcastId?: string | null;
  jobId?: string | null;
  sentBy?: string | null;
  retryCount?: number;
}

export interface DeliveryRow {
  id: string;
  status: "pending" | "sent" | "delivered" | "failed" | "bounced" | "skipped";
  templateKey: string | null;
  recipient: string;
  triggerSource: string;
  broadcastId: string | null;
  retryCount: number;
  createdAt: Date;
  sentAt: Date | null;
}

/** A short, secret-free summary of the SMTP outcome (never the raw error). */
function providerSummary(status: "sent" | "skipped" | "failed"): string {
  if (status === "sent") return "Accepted by SMTP server";
  if (status === "skipped") return "SMTP not configured — send skipped";
  return "SMTP send failed";
}

/**
 * Deliver an email then log the outcome to `email_deliveries`. Returns the logged
 * row (or `null` if logging failed — the send outcome is still honoured). Best-
 * effort: any DB error here is logged and swallowed, never rethrown.
 */
export async function deliverAndLog(
  options: { to: string; subject: string; text: string; html?: string },
  meta: DeliverAndLogMeta = {}
): Promise<DeliveryRow | null> {
  // `deliverMail` never throws (missing SMTP → skipped; failure → failed).
  const result = await deliverMail(options);
  const failureReason =
    result.status === "failed"
      ? String(maskFreeText((result.error ?? "Delivery failed").slice(0, 500)))
      : null;
  const providerResponse = providerSummary(result.status);
  const sentAt = result.status === "sent" ? new Date() : null;

  try {
    const { rows } = await query<DeliveryRow>(
      `INSERT INTO email_deliveries
         (template_key, category, subject, recipient, recipient_name, institution_id,
          trigger_source, status, failure_reason, provider_response, retry_count,
          related_type, related_id, broadcast_id, job_id, sent_by, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, status, template_key AS "templateKey", recipient,
                 trigger_source AS "triggerSource", broadcast_id AS "broadcastId",
                 retry_count AS "retryCount", created_at AS "createdAt", sent_at AS "sentAt"`,
      [
        meta.templateKey ?? null,
        meta.category ?? null,
        // Subject is metadata (never the body) but is still masked defensively so a
        // token accidentally rendered into a subject can never surface in the log.
        options.subject ? String(maskFreeText(options.subject.slice(0, 500))) : options.subject,
        options.to,
        meta.recipientName ?? null,
        meta.institutionId ?? null,
        meta.triggerSource ?? "system",
        result.status,
        failureReason,
        providerResponse,
        meta.retryCount ?? 0,
        meta.relatedType ?? null,
        meta.relatedId ?? null,
        meta.broadcastId ?? null,
        meta.jobId ?? null,
        meta.sentBy ?? null,
        sentAt,
      ]
    );
    return rows[0] ?? null;
  } catch (err) {
    // Delivery logging is best-effort observability — it must NEVER break a send
    // or a job. Log and continue.
    console.error("email delivery logging failed (continuing):", err);
    return null;
  }
}
