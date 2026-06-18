import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";

/**
 * Guards school-scoped routes: the caller must belong to an institution.
 * super_admin (cross-tenant, institutionId = null) is rejected here — it
 * operates via the /super-admin console, not a single school's data. Must run
 * after `authenticate`.
 */
export function requireTenant(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) throw ApiError.unauthorized();
  if (!req.user.institutionId) {
    throw ApiError.forbidden("Institution context required");
  }
  next();
}

/** The caller's institution id. Use after `requireTenant` (asserts non-null). */
export function tenantId(req: Request): string {
  const id = req.user?.institutionId;
  if (!id) throw ApiError.forbidden("Institution context required");
  return id;
}
