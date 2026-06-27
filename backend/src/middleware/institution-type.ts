import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";

export type InstitutionType = "school" | "college";

// An institution's type changes very rarely (only via the college/settings
// switch), so a short TTL cache keeps the type guard off the hot path without
// risking meaningful staleness. The switch endpoint busts the entry explicitly.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; type: InstitutionType }>();

/** The institution's type, cached briefly. Throws if the tenant is unknown. */
export async function getInstitutionType(
  institutionId: string
): Promise<InstitutionType> {
  const hit = cache.get(institutionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.type;
  const { rows } = await query<{ type: InstitutionType }>(
    "SELECT type FROM institutions WHERE id = $1",
    [institutionId]
  );
  if (rows.length === 0) {
    throw ApiError.forbidden("Institution context required");
  }
  const type = rows[0].type;
  cache.set(institutionId, { at: Date.now(), type });
  return type;
}

/** Drop a cached type (call after switching an institution's mode). */
export function invalidateInstitutionTypeCache(institutionId?: string): void {
  if (institutionId) cache.delete(institutionId);
  else cache.clear();
}

/**
 * Route guard restricting a feature to institutions of the given type(s) — the
 * backend half of School/College separation, so e.g. a school tenant can't
 * create college structures and vice-versa. Run after `requireTenant`.
 * super_admin (cross-tenant) bypasses.
 */
export function requireInstitutionType(...types: InstitutionType[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === "super_admin") return next();
    const institutionId = req.user.institutionId;
    if (!institutionId) throw ApiError.forbidden("Institution context required");
    const type = await getInstitutionType(institutionId);
    if (!types.includes(type)) {
      throw ApiError.forbidden(
        `This feature is only available for ${types.join(" / ")} institutions`
      );
    }
    next();
  };
}
