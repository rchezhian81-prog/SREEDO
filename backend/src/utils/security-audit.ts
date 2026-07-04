import type { Request } from "express";
import { query } from "../db/postgres";

/**
 * Durable security-audit trail.
 *
 * Security-significant events (logins, password resets, 2FA changes, admin
 * recovery actions, user lifecycle) are written to the always-available
 * `platform_audit_log` table — the same authoritative store used for platform
 * super-admin actions. Unlike the best-effort MongoDB request log
 * (`middleware/audit.ts`), this survives even when MongoDB is unconfigured.
 *
 * Rows are tenant-attributable via `institution_id` and never contain secrets
 * (no passwords, tokens, hashes — only a curated, non-sensitive `detail`).
 */
export interface SecurityEvent {
  /** Namespaced action, e.g. "auth.login.success", "user.2fa_reset". */
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  institutionId?: string | null;
  targetType?: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Best-effort durable record of a security event. NEVER throws into the request
 * path — an audit-write failure must not block a login or an admin action.
 */
export async function recordSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await query(
      `INSERT INTO platform_audit_log
         (action, target_type, target_id, institution_id,
          actor_id, actor_email, actor_role, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        event.action,
        event.targetType ?? "user",
        event.targetId ?? null,
        event.institutionId ?? null,
        event.actorId ?? null,
        event.actorEmail ?? null,
        event.actorRole ?? null,
        JSON.stringify(event.detail ?? {}),
        event.ip ?? null,
      ]
    );
  } catch (err) {
    // Audit must never break the originating request — log and move on.
    console.error(`Failed to record security event ${event.action}:`, err);
  }
}

/** Client IP, honouring the `trust proxy` setting (real client behind nginx). */
export function clientIp(req: Request): string | null {
  const ip = req.ip;
  if (!ip) return null;
  // A dual-stack listener surfaces an IPv4 client as an IPv4-mapped IPv6 address
  // (e.g. "::ffff:127.0.0.1"). Normalize it back to plain IPv4 so captured IPs
  // are consistent across requests and match IPv4 allowlist/CIDR entries; without
  // this the same client can appear as "::ffff:1.2.3.4" on one request and
  // "1.2.3.4" on another (the exact behaviour differs between hosts and is why
  // an IP-allowlist round-trip that passes locally could fail on CI).
  return ip.startsWith("::ffff:") && ip.includes(".") ? ip.slice("::ffff:".length) : ip;
}
