import { randomBytes, createHash } from "node:crypto";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createApiKeySchema,
  createWebhookSchema,
  updateWebhookSchema,
} from "./integrations.schema";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// ------------------------------------------------------------------- API keys

export async function listApiKeys(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, key_prefix AS "keyPrefix", is_active AS "isActive",
            last_used_at AS "lastUsedAt", created_at AS "createdAt"
     FROM api_keys WHERE institution_id = $1 ORDER BY created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function createApiKey(
  input: z.infer<typeof createApiKeySchema>,
  institutionId: string,
  userId: string
) {
  const prefix = `sk_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("hex");
  const fullKey = `${prefix}_${secret}`;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO api_keys (institution_id, name, key_prefix, key_hash, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [institutionId, input.name, prefix, sha256(fullKey), userId]
  );
  // The full key is returned only here, never again.
  return { id: rows[0].id, name: input.name, key: fullKey, keyPrefix: prefix };
}

export async function revokeApiKey(id: string, institutionId: string) {
  const { rows } = await query<{ id: string }>(
    `UPDATE api_keys SET is_active = false WHERE id = $1 AND institution_id = $2 RETURNING id`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("API key not found");
  return { id, isActive: false };
}

export async function deleteApiKey(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM api_keys WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("API key not found");
}

/**
 * Resolve an API key to its tenant (for future API-key authenticated access).
 * Returns the institution id, or null if the key is unknown/inactive.
 */
export async function resolveApiKey(fullKey: string): Promise<string | null> {
  const { rows } = await query<{ institution_id: string }>(
    "SELECT institution_id FROM api_keys WHERE key_hash = $1 AND is_active = true",
    [sha256(fullKey)]
  );
  if (!rows[0]) return null;
  await query("UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1", [sha256(fullKey)]);
  return rows[0].institution_id;
}

// -------------------------------------------------------------------- webhooks

const WEBHOOK_SELECT = `
  id, url, description, event_types AS "eventTypes", is_active AS "isActive",
  created_at AS "createdAt"
FROM webhook_endpoints`;

export async function listWebhooks(institutionId: string) {
  const { rows } = await query(
    `SELECT ${WEBHOOK_SELECT} WHERE institution_id = $1 ORDER BY created_at DESC`,
    [institutionId]
  );
  return rows;
}

async function getWebhook(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${WEBHOOK_SELECT} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Webhook not found");
  return rows[0];
}

export async function createWebhook(
  input: z.infer<typeof createWebhookSchema>,
  institutionId: string,
  userId: string
) {
  // The signing secret is generated here and returned ONCE (like an API key);
  // the masked SELECT never exposes it again. Receivers use it to verify the
  // X-Sreedo-Signature HMAC on each delivery.
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO webhook_endpoints (institution_id, url, description, event_types, secret, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [institutionId, input.url, input.description ?? null, input.eventTypes ?? "*", secret, userId]
  );
  const created = await getWebhook(rows[0].id, institutionId);
  return { ...created, secret };
}

export async function listDeliveries(webhookId: string, institutionId: string) {
  await getWebhook(webhookId, institutionId); // 404s if it isn't this tenant's
  const { rows } = await query(
    `SELECT id, event_type AS "eventType", status_code AS "statusCode", success,
            error, attempt, created_at AS "createdAt"
     FROM webhook_deliveries
     WHERE webhook_id = $1 AND institution_id = $2
     ORDER BY created_at DESC LIMIT 50`,
    [webhookId, institutionId]
  );
  return rows;
}

const WEBHOOK_UPDATE_MAP: Record<string, string> = {
  url: "url",
  description: "description",
  eventTypes: "event_types",
  isActive: "is_active",
};

export async function updateWebhook(
  id: string,
  input: z.infer<typeof updateWebhookSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(WEBHOOK_UPDATE_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE webhook_endpoints SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Webhook not found");
  return getWebhook(id, institutionId);
}

export async function deleteWebhook(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM webhook_endpoints WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Webhook not found");
}
