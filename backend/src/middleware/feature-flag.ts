import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";

// Per-tenant feature gating. The source of truth is the institution's own
// settings JSONB (set by the super-admin per tenant, NOT by the package master):
//   settings.featureFlags = { "<key>": true | false }
// Semantics are DEFAULT-ALLOW: a feature is enabled unless it is *explicitly*
// turned off (`featureFlags[key] === false`). This keeps every existing tenant
// working unchanged — a flag only ever removes access when an operator sets it —
// and lets the operator switch an optional module off for a specific tenant.
//
// Flags change rarely (a super-admin toggles them), so a short TTL cache keeps
// the check off the hot path; the settings-update path busts the entry.

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; flags: Record<string, unknown> }>();

async function featureFlags(institutionId: string): Promise<Record<string, unknown>> {
  const hit = cache.get(institutionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flags;
  const { rows } = await query<{ flags: Record<string, unknown> | null }>(
    `SELECT settings->'featureFlags' AS flags FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const flags = rows[0]?.flags ?? {};
  cache.set(institutionId, { at: Date.now(), flags });
  return flags;
}

/** True unless the institution has explicitly disabled this feature key. */
export async function isFeatureEnabled(
  institutionId: string,
  key: string
): Promise<boolean> {
  const flags = await featureFlags(institutionId);
  return flags[key] !== false;
}

/** Drop a cached feature-flag entry (call after updating a tenant's settings). */
export function invalidateFeatureFlagCache(institutionId?: string): void {
  if (institutionId) cache.delete(institutionId);
  else cache.clear();
}

/**
 * OPT-IN route guard (PR-T11): passes ONLY when the institution has explicitly
 * enabled the key (`settings.featureFlags[key] === true`) — default-DENY, for
 * net-new higher-risk surfaces that must be off until a tenant is opted in
 * (e.g. the AI Copilot). Reuses the same JSONB source, TTL cache and
 * `invalidateFeatureFlagCache` bust as `requireFeature`; super_admin bypasses.
 * Existing routes keep using the default-allow `requireFeature` unchanged.
 */
export function requireFeatureOptIn(key: string, label?: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === "super_admin") return next();
    const institutionId = req.user.institutionId;
    if (!institutionId) throw ApiError.forbidden("Institution context required");
    const flags = await featureFlags(institutionId);
    if (flags[key] !== true) {
      throw ApiError.forbidden(
        `The ${label ?? key} feature is not enabled for this institution`
      );
    }
    next();
  };
}

/**
 * Route guard that blocks a feature when the caller's institution has explicitly
 * disabled it (`settings.featureFlags[key] === false`). Default-allow, so it is
 * safe to add to existing routes. Run after `authenticate` (+ `requireTenant`).
 * super_admin (cross-tenant) bypasses.
 */
export function requireFeature(key: string, label?: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === "super_admin") return next();
    const institutionId = req.user.institutionId;
    if (!institutionId) throw ApiError.forbidden("Institution context required");
    if (!(await isFeatureEnabled(institutionId, key))) {
      throw ApiError.forbidden(
        `The ${label ?? key} module is not enabled for this institution`
      );
    }
    next();
  };
}
