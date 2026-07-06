import { query } from "../../db/postgres";

/**
 * Shared audit actor + writer for Super Admin L (Health / Observability).
 *
 * Mirrors backups.service / exports.service: a durable, secret-free row in
 * platform_audit_log. Because `incident.*` and `alert.*` are in the high-risk
 * action regex (kept in sync in security.service + audit.service), critical
 * incident/alert actions automatically surface in the Security Center + Audit
 * high-risk feeds. `target_type` defaults to 'incident'; pass 'alert' (or another
 * type) for the alert / error consoles.
 */

export interface Actor {
  id: string | null;
  email: string;
  role: string;
  ip: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, email: "system", role: "system", ip: null };

interface AuditInput {
  action: string;
  targetType?: string;
  targetId: string | null;
  institutionId?: string | null;
  detail?: Record<string, unknown>;
}

/** Durable platform audit entry (never includes secrets or storage paths). */
export async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      input.action,
      input.targetType ?? "incident",
      input.targetId,
      input.institutionId ?? null,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(input.detail ?? {}),
      actor.ip,
    ]
  );
}
