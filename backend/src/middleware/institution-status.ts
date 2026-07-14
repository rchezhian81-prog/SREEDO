import type { Request } from "express";
import { query } from "../db/postgres";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import { recordAudit, type Actor } from "../modules/observability/audit";

/**
 * PR-SEC2 — Tenant suspension enforcement.
 *
 * A tenant's suspension already lives in the data model (`institutions.is_active`
 * / `status`), set either manually by a super-admin (`tenant.service.setLifecycle`)
 * or automatically by billing (dunning-exhausted / subscription-expired). Nothing
 * used to read it in the access path, so a suspended tenant kept full access. This
 * module closes that gap at the two choke points every authenticated request or
 * sign-in passes through: `authenticate`/`authenticateSetup` (see middleware/auth)
 * and `auth.service.login`.
 *
 * Source of truth: `is_active`. It is false for EVERY non-operational status
 * (suspended / expired / archived / closed) and is set by both the manual and the
 * billing paths, so enforcement never depends on `status` (which we read only to
 * word the message). The whole feature sits behind the OFF-by-default
 * ENFORCE_TENANT_SUSPENSION kill-switch, and the lookup FAILS OPEN on a DB error.
 */

interface InstitutionState {
  active: boolean;
  status: string;
}

// Short-TTL cache keyed by institution id — mirrors the RBAC permission caches.
// Suspension takes effect within the TTL, and setLifecycle busts it for immediacy
// on the manual path. Deliberately cheap: one indexed PK lookup on a cache miss.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; state: InstitutionState }>();

/** Drop a cached institution state (call after suspend / reactivate). */
export function invalidateInstitutionStatusCache(id?: string): void {
  if (id) cache.delete(id);
  else cache.clear();
}

/**
 * Look up an institution's active flag + status. Returns null when the row is
 * absent (caller treats "unknown" as fail-open — never lock out on a missing
 * row). Throws only on a real DB error, which callers catch and fail open.
 */
async function lookupInstitution(id: string): Promise<InstitutionState | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
  const { rows } = await query<{ is_active: boolean; status: string }>(
    "SELECT is_active, status FROM institutions WHERE id = $1",
    [id]
  );
  if (!rows[0]) return null;
  const state: InstitutionState = { active: rows[0].is_active === true, status: rows[0].status };
  cache.set(id, { at: Date.now(), state });
  return state;
}

/** A 403 the frontend can key on (details.code) to show the suspended screen. */
function suspendedError(status: string): ApiError {
  const message =
    status === "expired"
      ? "This institution's subscription has expired. Please contact your administrator."
      : status === "archived" || status === "closed"
        ? "This institution is no longer active. Please contact our support team."
        : "This institution has been suspended. Please contact your administrator or our support team.";
  return new ApiError(403, message, { code: "INSTITUTION_SUSPENDED", status });
}

const actorFromReq = (req: Request): Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

// Dedupe window for the high-frequency request-path audits (access-blocked /
// support-bypass). Login-blocked is audited per attempt (already rate-limited).
const AUDIT_WINDOW_MS = 10 * 60_000;
const lastAudited = new Map<string, number>();
function shouldAudit(key: string): boolean {
  const now = Date.now();
  const last = lastAudited.get(key);
  if (last && now - last < AUDIT_WINDOW_MS) return false;
  lastAudited.set(key, now);
  return true;
}
async function auditSafe(actor: Actor, input: Parameters<typeof recordAudit>[1]): Promise<void> {
  try {
    await recordAudit(actor, input);
  } catch (err) {
    console.error("Suspension audit write failed (continuing):", err);
  }
}

/**
 * Request-path guard. Run after `authenticate` has populated `req.user`. Blocks a
 * suspended tenant's users; exempts super_admin (no institution) and audited
 * platform-support impersonation sessions (Decision A — bypass is reason/audit
 * logged and can never be a normal tenant-user bypass, because `req.support` is
 * only ever set for an impersonation token).
 */
export async function assertInstitutionActive(req: Request): Promise<void> {
  if (!env.enforceTenantSuspension) return; // kill-switch OFF → no-op
  const institutionId = req.user?.institutionId;
  if (!institutionId) return; // super_admin / platform user — nothing to gate

  let state: InstitutionState | null;
  try {
    state = await lookupInstitution(institutionId);
  } catch (err) {
    // Fail-open: a DB outage must not lock every tenant out at once.
    console.error("Suspension check failed (allowing request):", err);
    return;
  }
  if (!state || state.active) return; // active (or unknown row) → allow

  // Suspended. Audited platform-support impersonation bypasses (Decision A).
  if (req.support) {
    if (shouldAudit(`bypass:${institutionId}:${req.user!.sessionId ?? ""}`)) {
      await auditSafe(actorFromReq(req), {
        action: "tenant.suspension.support_bypass",
        targetType: "institution",
        targetId: institutionId,
        institutionId,
        detail: { status: state.status, support: req.support },
      });
    }
    return;
  }

  if (shouldAudit(`blocked:${institutionId}:${req.user!.id}`)) {
    await auditSafe(actorFromReq(req), {
      action: "tenant.suspension.access_blocked",
      targetType: "institution",
      targetId: institutionId,
      institutionId,
      detail: { status: state.status, path: req.path },
    });
  }
  throw suspendedError(state.status);
}

/**
 * Login-path guard. Blocks issuing tokens to a suspended tenant's user AFTER their
 * credentials are verified (so suspension status never leaks to a wrong-password
 * attempt). super_admin (null institution) is exempt; there is no support context
 * at login. Audited per attempt (login is rate-limited).
 */
export async function assertInstitutionActiveForLogin(
  user: { id: string; email: string; role: string; institution_id: string | null },
  ip: string | null
): Promise<void> {
  if (!env.enforceTenantSuspension) return;
  if (!user.institution_id) return;

  let state: InstitutionState | null;
  try {
    state = await lookupInstitution(user.institution_id);
  } catch (err) {
    console.error("Suspension check failed at login (allowing):", err);
    return;
  }
  if (!state || state.active) return;

  await auditSafe(
    { id: user.id, email: user.email, role: user.role, ip },
    {
      action: "tenant.suspension.login_blocked",
      targetType: "institution",
      targetId: user.institution_id,
      institutionId: user.institution_id,
      detail: { status: state.status },
    }
  );
  throw suspendedError(state.status);
}
