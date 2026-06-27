import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ApiError } from "../utils/api-error";
import { ACCESS_COOKIE, REFRESH_COOKIE, getCookie } from "../utils/cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Bearer-token requests aren't CSRF-prone (the browser never auto-sends them). */
function isCookieAuthenticated(req: Request): boolean {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return false;
  return Boolean(
    getCookie(req, ACCESS_COOKIE) || getCookie(req, REFRESH_COOKIE)
  );
}

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth CSRF guard for the cookie-authenticated portal.
 *
 * The student/parent portal authenticates with httpOnly cookies, which the
 * browser attaches automatically — so a state-changing request riding on a
 * cookie must originate from an allowed web origin. `SameSite=Lax` already
 * blocks the cross-site POST/PUT/PATCH/DELETE that matters; this verifies the
 * Origin/Referer as a second, explicit layer.
 *
 * Unaffected (pass through):
 *  - Safe methods (GET/HEAD/OPTIONS).
 *  - Bearer-token clients (staff SPA, mobile app).
 *  - Server-to-server callers with no auth cookie (payment/webhook receivers,
 *    biometric device ingest, x-api-key `/ext`).
 *  - Native clients that omit Origin/Referer entirely.
 */
export function csrfOriginGuard(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isCookieAuthenticated(req)) return next();

  const origin =
    req.headers.origin ?? originFromReferer(req.headers.referer);
  if (!origin) return next();
  if (env.corsOrigin.includes(origin)) return next();

  throw ApiError.forbidden("Cross-origin request blocked");
}
