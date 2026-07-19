import { query } from "../../db/postgres";

/**
 * Read-only, per-tenant runtime resolver for the AUDITED platform feature-flag
 * registry (platform_feature_flags). PR-UI2 consumes it for the `ui_v2` skin flag.
 *
 * The single source of truth and the audited super-admin setter / settings-history
 * / rollback live in platform-settings.service.ts and are NOT touched here — this
 * module only READS.
 *
 * A flag is effective for a tenant ONLY when the row exists, status = 'enabled',
 * AND the caller's own institution id is explicitly listed in allowed_tenants.
 * Anything else (missing row, disabled/rollout, not allow-listed) => false. Any
 * DB/parse error => false (fail-safe). The institution id is supplied exclusively
 * by the authenticated server context (req.user.institutionId); a client-supplied
 * tenant id is never read here.
 */

export interface FlagRuntimeRow {
  status: string;
  allowed: string[];
}

/** Pure, DB-free evaluation (unit-testable): enabled + explicit allow-list only. */
export function evaluatePlatformFlag(
  row: FlagRuntimeRow | null,
  institutionId: string | null | undefined
): boolean {
  return (
    !!row &&
    !!institutionId &&
    row.status === "enabled" &&
    row.allowed.includes(institutionId)
  );
}

// Flags change rarely (a super-admin toggles them via the audited platform
// surface); a short TTL keeps the check off the hot path. Staleness only matters
// once the flag is targeted at a pilot — irrelevant while PR-UI2 keeps it absent.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; row: FlagRuntimeRow | null }>();

async function readFlag(key: string): Promise<FlagRuntimeRow | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const { rows } = await query<{ status: string; allowed_tenants: string[] | null }>(
    `SELECT status, allowed_tenants FROM platform_feature_flags WHERE key = $1`,
    [key]
  );
  const row: FlagRuntimeRow | null = rows[0]
    ? { status: rows[0].status, allowed: rows[0].allowed_tenants ?? [] }
    : null;
  cache.set(key, { at: Date.now(), row });
  return row;
}

/**
 * True IFF the flag is enabled and this institution is explicitly allow-listed.
 * `institutionId` MUST come from the authenticated server context. Fails safe to
 * false on any error.
 */
export async function isPlatformFeatureEnabledForTenant(
  institutionId: string | null | undefined,
  key: string
): Promise<boolean> {
  try {
    if (!institutionId) return false;
    return evaluatePlatformFlag(await readFlag(key), institutionId);
  } catch {
    return false;
  }
}

/** Test seam — drop the resolver's TTL cache. */
export function __clearPlatformFeatureRuntimeCache(): void {
  cache.clear();
}
