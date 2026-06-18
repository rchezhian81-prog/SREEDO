import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";
import type { UserRole } from "../types";

// In-memory cache of role -> permission keys. The catalogue is static reference
// data (seeded by migration), so a short TTL is plenty and avoids a DB hit on
// every guarded request.
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

/** Clears the permission cache (e.g. after editing grants). */
export function invalidatePermissionCache(): void {
  cache = null;
}

/** The effective permission keys for a role (super_admin gets everything). */
export async function permissionsForRole(role: UserRole): Promise<string[]> {
  if (role === "super_admin") {
    const { rows } = await query<{ key: string }>("SELECT key FROM permissions");
    return rows.map((row) => row.key);
  }
  const map = await loadRolePermissions();
  return [...(map.get(role) ?? [])];
}

/**
 * Route guard requiring a specific `module:action` permission. Must run after
 * `authenticate`. super_admin bypasses (platform god role).
 */
export function requirePermission(key: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === "super_admin") return next();
    const map = await loadRolePermissions();
    if (map.get(req.user.role)?.has(key)) return next();
    throw ApiError.forbidden();
  };
}
