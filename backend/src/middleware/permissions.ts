import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";
import type { AuthenticatedUser, UserRole } from "../types";

// In-memory cache of role -> permission keys. The catalogue is static reference
// data (seeded by migration + edited via the RBAC console), so a short TTL is
// plenty and avoids a DB hit on every guarded request. The `role` key here is a
// free string: tenant roles (admin/teacher/…), the enum super_admin, AND the
// platform sub-role / custom-role keys (owner/platform_admin/billing_admin/…).
const TTL_MS = 60_000;
let cache: { at: number; map: Map<string, Set<string>> } | null = null;

async function loadRolePermissions(): Promise<Map<string, Set<string>>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const { rows } = await query<{ role: string; key: string }>(
    `SELECT rp.role, p.key
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id`
  );
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.role)) map.set(row.role, new Set());
    map.get(row.role)!.add(row.key);
  }
  cache = { at: Date.now(), map };
  return map;
}

/** Clears the role→permission cache (e.g. after editing grants). */
export function invalidatePermissionCache(): void {
  cache = null;
}

// --- Per-tenant permission overrides (PR-T2) -------------------------------
//
// The global role_permissions above is shared by every tenant. Tenant RBAC v2
// layers per-institution overrides on top: effect='grant' adds a key to the
// role's global default, effect='deny' removes one. A tenant with NO override
// rows resolves to exactly the global defaults, so this is a pure no-op until a
// tenant customises its roles. Cached per institution with the same short TTL
// and busted by invalidateTenantOverrideCache() after an edit.
type TenantOverride = { grant: Set<string>; deny: Set<string> };
const tenantCache = new Map<string, { at: number; map: Map<string, TenantOverride> }>();

async function loadTenantOverrides(
  institutionId: string
): Promise<Map<string, TenantOverride>> {
  const hit = tenantCache.get(institutionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const { rows } = await query<{ role: string; permission_key: string; effect: string }>(
    `SELECT role, permission_key, effect
     FROM tenant_role_permissions
     WHERE institution_id = $1`,
    [institutionId]
  );
  const map = new Map<string, TenantOverride>();
  for (const row of rows) {
    let ov = map.get(row.role);
    if (!ov) {
      ov = { grant: new Set(), deny: new Set() };
      map.set(row.role, ov);
    }
    (row.effect === "deny" ? ov.deny : ov.grant).add(row.permission_key);
  }
  tenantCache.set(institutionId, { at: Date.now(), map });
  return map;
}

/** Clears cached per-tenant overrides (call after editing a tenant's grants). */
export function invalidateTenantOverrideCache(institutionId?: string): void {
  if (institutionId) tenantCache.delete(institutionId);
  else tenantCache.clear();
}

/** Merge a role's global default keys with a tenant's overrides (deny wins). */
function mergeTenantOverrides(
  base: Set<string> | undefined,
  ov: TenantOverride | undefined
): Set<string> {
  const out = new Set<string>(base ?? []);
  if (ov) {
    for (const k of ov.grant) out.add(k);
    for (const k of ov.deny) out.delete(k);
  }
  return out;
}

// --- Platform sub-role resolution (Super Admin H) ---------------------------
//
// Every platform-team member has user_role='super_admin', so a role check alone
// would make them all omnipotent. Enforcement instead keys off the per-user
// `platform_role`:
//   • platform_role NULL  → treated as full access (legacy/bootstrap/emergency
//     super_admin that predates classification — never locked out).
//   • platform_role 'owner' (or a role flagged is_owner) → full access.
//   • any other platform_role → limited to that role's granted permission keys.
// The lookup is cached briefly per user id and busted when a role is (re)assigned,
// so a role change takes effect immediately without forcing re-login.

const roleCache = new Map<string, { at: number; platformRole: string | null }>();
const ownerRolesCache = { at: 0, keys: new Set<string>(["owner"]) };

/** Drop the cached platform_role for a user (call after assigning their role). */
export function invalidatePlatformRoleCache(userId?: string): void {
  if (userId) roleCache.delete(userId);
  else roleCache.clear();
}

async function platformRoleOf(userId: string): Promise<string | null> {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.platformRole;
  const { rows } = await query<{ platform_role: string | null }>(
    "SELECT platform_role FROM users WHERE id = $1",
    [userId]
  );
  const platformRole = rows[0]?.platform_role ?? null;
  roleCache.set(userId, { at: Date.now(), platformRole });
  return platformRole;
}

/** Role keys that confer full access (owner). Cached; owner is always included. */
async function ownerRoleKeys(): Promise<Set<string>> {
  if (Date.now() - ownerRolesCache.at < TTL_MS) return ownerRolesCache.keys;
  const keys = new Set<string>(["owner"]);
  try {
    const { rows } = await query<{ key: string }>(
      "SELECT key FROM rbac_roles WHERE is_owner = true"
    );
    for (const r of rows) keys.add(r.key);
  } catch {
    // rbac_roles may not exist yet (pre-migration) — owner is the safe default.
  }
  ownerRolesCache.at = Date.now();
  ownerRolesCache.keys = keys;
  return keys;
}

/**
 * A platform user (super_admin) has FULL access when unclassified (NULL) or an
 * owner role. Exposed so services can apply the same rule (e.g. owner-safety).
 */
export async function isFullAccessPlatformUser(userId: string): Promise<boolean> {
  const pr = await platformRoleOf(userId);
  if (pr === null) return true;
  return (await ownerRoleKeys()).has(pr);
}

/**
 * The EFFECTIVE permission keys for the authenticated user. Tenant roles resolve
 * from role_permissions by user_role; platform users resolve by platform_role
 * (owner/NULL → every key). Used by GET /auth/permissions and the frontend.
 */
export async function effectivePermissions(user: {
  id: string;
  role: UserRole;
  institutionId?: string | null;
}): Promise<string[]> {
  if (user.role !== "super_admin") {
    const base = (await loadRolePermissions()).get(user.role);
    if (!user.institutionId) return [...(base ?? [])];
    const ov = (await loadTenantOverrides(user.institutionId)).get(user.role);
    return [...mergeTenantOverrides(base, ov)];
  }
  if (await isFullAccessPlatformUser(user.id)) {
    const { rows } = await query<{ key: string }>("SELECT key FROM permissions");
    return rows.map((r) => r.key);
  }
  const pr = await platformRoleOf(user.id);
  const map = await loadRolePermissions();
  return pr ? [...(map.get(pr) ?? [])] : [];
}

/**
 * For a tenant role: its global default keys, its per-tenant overrides, and the
 * resulting effective keys. Powers the tenant RBAC matrix/detail (PR-T2).
 */
export async function tenantRolePermissions(
  institutionId: string,
  role: UserRole
): Promise<{ defaults: string[]; effective: string[]; grants: string[]; denies: string[] }> {
  const base = (await loadRolePermissions()).get(role) ?? new Set<string>();
  const ov = (await loadTenantOverrides(institutionId)).get(role);
  return {
    defaults: [...base],
    effective: [...mergeTenantOverrides(base, ov)],
    grants: ov ? [...ov.grant] : [],
    denies: ov ? [...ov.deny] : [],
  };
}

/** The effective permission keys for a bare role (tenant roles + super_admin=all). */
export async function permissionsForRole(role: UserRole): Promise<string[]> {
  if (role === "super_admin") {
    const { rows } = await query<{ key: string }>("SELECT key FROM permissions");
    return rows.map((row) => row.key);
  }
  const map = await loadRolePermissions();
  return [...(map.get(role) ?? [])];
}

async function userHasPermission(user: AuthenticatedUser, key: string): Promise<boolean> {
  if (user.role !== "super_admin") {
    const base = (await loadRolePermissions()).get(user.role);
    if (!user.institutionId) return base?.has(key) ?? false;
    // Per-tenant override: deny wins over grant wins over the global default.
    const ov = (await loadTenantOverrides(user.institutionId)).get(user.role);
    if (ov?.deny.has(key)) return false;
    if (ov?.grant.has(key)) return true;
    return base?.has(key) ?? false;
  }
  // Platform user: owner / unclassified → full access; otherwise per platform_role.
  if (await isFullAccessPlatformUser(user.id)) return true;
  const pr = await platformRoleOf(user.id);
  if (!pr) return true; // defensive: NULL already handled above
  const map = await loadRolePermissions();
  return map.get(pr)?.has(key) ?? false;
}

/**
 * Route guard requiring a specific `module:action` permission. Must run after
 * `authenticate`. Platform owners (and unclassified super_admins) bypass; other
 * platform sub-roles and tenant roles are checked against their granted keys.
 */
export function requirePermission(key: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (await userHasPermission(req.user, key)) return next();
    throw ApiError.forbidden();
  };
}
