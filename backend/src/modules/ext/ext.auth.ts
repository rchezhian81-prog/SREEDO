import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../utils/api-error";
import { resolveApiKey } from "../integrations/integrations.service";

/**
 * Authenticate a request by its `x-api-key` header (a per-institution API key)
 * and attach a tenant-scoped service principal. Used only by the read-only /ext
 * API. The principal acts as the admin who created the key, so any audit columns
 * resolve to a real user. Async throws are caught by Express 5 and formatted by
 * the error middleware, exactly like the route handlers.
 */
export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const key = req.header("x-api-key");
  if (!key) throw ApiError.unauthorized("Missing API key");
  const resolved = await resolveApiKey(key.trim());
  if (!resolved) throw ApiError.unauthorized("Invalid or revoked API key");
  req.user = {
    // created_by is the audit principal; fall back to the (valid-UUID) institution
    // id if that user was removed — /ext is read-only so this id is never an FK.
    id: resolved.userId ?? resolved.institutionId,
    email: "api-key@service",
    role: "admin",
    institutionId: resolved.institutionId,
    sessionId: "api-key",
  };
  next();
}
