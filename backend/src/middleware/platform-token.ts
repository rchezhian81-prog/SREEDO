import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";

/**
 * Platform API-token authentication (Super Admin P — Phase 2).
 *
 * Governs the read-only external surface (`/platform/ext/*`). The caller presents
 * the raw token in the `X-Platform-Token` header; only its SHA-256 hash is ever
 * compared against `platform_api_tokens` (the plaintext is never stored). A
 * missing/unknown/expired/revoked token is 401; a valid token that lacks the
 * required scope is 403. On success `req.platformToken` is populated and
 * `last_used_at` is stamped. This never issues a JWT and never returns secrets.
 */
const HEADER = "x-platform-token";

export function authenticatePlatformToken(requiredScope: string) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    const raw = req.header(HEADER);
    if (!raw) throw ApiError.unauthorized("Platform API token required");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const { rows } = await query<{ id: string; name: string; scopes: string[] }>(
      `SELECT id, name, scopes FROM platform_api_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())`,
      [tokenHash]
    );
    const token = rows[0];
    if (!token) throw ApiError.unauthorized("Invalid or expired platform API token");
    if (!token.scopes.includes(requiredScope)) {
      throw ApiError.forbidden(`This token lacks the required scope: ${requiredScope}`);
    }
    req.platformToken = { id: token.id, name: token.name, scopes: token.scopes };
    await query("UPDATE platform_api_tokens SET last_used_at = now() WHERE id = $1", [
      token.id,
    ]);
    next();
  };
}
