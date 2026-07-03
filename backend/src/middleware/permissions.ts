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
}): Promise<string[]> {
  if (user.role !== "super_admin") {
    const map = await loadRolePermissions();
    return [...(map.get(user.role) ?? [])];
  }
  if (await isFullAccessPlatformUser(user.id)) {
    const { rows } = await query<{ key: string }>("SELECT key FROM permissions");
    return rows.map((r) => r.key);
  }
  const pr = await platformRoleOf(user.id);
  const map = await loadRolePermissions();
  return pr ? [...(map.get(pr) ?? [])] : [];
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
    const map = await loadRolePermissions();
    return map.get(user.role)?.has(key) ?? false;
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
