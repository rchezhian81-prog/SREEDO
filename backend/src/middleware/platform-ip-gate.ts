import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { clientIp } from "../utils/security-audit";
import { isIpAllowed } from "../modules/platform/security.service";

/**
 * Platform IP-allowlist gate (Super Admin P — Phase 2).
 *
 * ENFORCED SURFACE: mounted at ROUTER level (after authenticate + authorize) on
 * the platform-admin consoles — `superadmin`, `adminconsole`, `platform`,
 * `platform-admins`, `rbac` — plus the Security Center's sensitive mutations
 * (the `security` router keeps its Phase-1 per-route arrangement so the
 * allowlist controls stay reachable).
 *
 * NOT ENFORCED: `/auth/*` (never — a locked-out operator must still be able to
 * sign in), the public platform routes (invite-accept, webhooks), the governed
 * external token surface, and the IP-allowlist management routes themselves.
 *
 * `isIpAllowed` fail-opens when the allowlist is DISABLED or EMPTY, so this is a
 * pure no-op until an operator both adds an entry AND enables enforcement — and
 * enabling already refuses unless the caller's own current IP is covered
 * (self-lockout safe). A transient failure inside `isIpAllowed` is not caught
 * here: it surfaces as a normal error rather than silently allowing.
 */
export async function platformIpGate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!(await isIpAllowed(clientIp(req)))) {
    throw ApiError.forbidden(
      "Your IP address is not permitted by the platform allowlist"
    );
  }
  next();
}
