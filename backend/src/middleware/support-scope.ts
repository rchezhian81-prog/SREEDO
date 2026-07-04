import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";
import { ACCESS_COOKIE, getCookie } from "../utils/cookies";
import { verifyAccessToken } from "../utils/jwt";
import { clientIp, recordSecurityEvent } from "../utils/security-audit";

/**
 * SUPPORT-ACCESS SCOPE ENFORCEMENT — the security keystone of the governed
 * support-session system.
 *
 * SAFETY GUARANTEE: this middleware is a NO-OP for every normal request. It only
 * changes behaviour for a token that carries an `imp` (support) claim:
 *   - no token            -> next()  (authenticate handles missing auth)
 *   - token fails verify  -> next()  (authenticate returns the 401)
 *   - token has NO `imp`  -> next()  (NORMAL TRAFFIC, untouched)
 * No token in the system carried an `imp` claim before this feature, so mounting
 * this cannot regress any existing flow. Only support tokens reach the gate below.
 *
 * For a support token it enforces, per request, that:
 *   - the DB session row is still live (active, not expired/ended/revoked) — so a
 *     revoke or expiry is felt IMMEDIATELY even though the JWT is still valid;
 *   - a `read_only` session cannot mutate data;
 *   - a `module_limited` session only touches its allowed modules.
 * The operator is never bricked: reading own identity (GET /auth/me) and logging
 * out (POST /auth/logout) are always allowed.
 */

/** Bearer header (staff) takes precedence; falls back to the portal cookie. Mirrors auth.ts. */
function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return getCookie(req, ACCESS_COOKIE);
}

/**
 * Approximate path -> module map for `module_limited` scope. Prefixes are matched
 * on segment boundaries against the api sub-path (e.g. "/students/123"). Anything
 * unmapped resolves to the sentinel "other" and is therefore DENIED unless the
 * session explicitly lists it — deny-by-default. "overview" is non-sensitive
 * context and is always readable within a module-limited session.
 */
const MODULE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["/students", "students"],
  ["/teachers", "staff"],
  ["/staff", "staff"],
  ["/payroll", "staff"],
  ["/leave", "staff"],
  ["/fees", "fees"],
  ["/attendance", "attendance"],
  ["/period-attendance", "attendance"],
  ["/exams", "exams"],
  ["/online-exams", "exams"],
  ["/quizzes", "exams"],
  ["/announcements", "communication"],
  ["/messages", "communication"],
  ["/notifications", "communication"],
  ["/communication", "communication"],
  ["/reports", "reports"],
  ["/report-center", "reports"],
  ["/documents", "documents"],
  ["/files", "documents"],
  ["/invoices", "billing"],
  ["/billing", "billing"],
  ["/payments", "billing"],
  ["/online-payments", "billing"],
  ["/settings", "settings"],
  ["/dashboard", "overview"],
  ["/me", "overview"],
  ["/overview", "overview"],
  ["/auth", "overview"],
];

/** Resolve a request sub-path to a coarse module key (approximate; deny-by-default). */
export function moduleForPath(path: string): string {
  for (const [prefix, mod] of MODULE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return mod;
  }
  return "other";
}

/** Reading own identity + logging out are always permitted (never brick the operator). */
function isAlwaysAllowed(req: Request): boolean {
  return (
    (req.method === "GET" && req.path === "/auth/me") ||
    (req.method === "POST" && req.path === "/auth/logout")
  );
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function enforceSupportScope(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = readAccessToken(req);
  if (!token) return next(); // missing auth — let authenticate 401 it

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(); // invalid/expired — authenticate will 401 it
  }

  const imp = payload.imp;
  if (!imp) return next(); // ← NORMAL TRAFFIC: untouched. The safety guarantee.

  // From here the request bears a support token: validate the stateful session.
  const { rows } = await query<{ status: string; expires_at: Date }>(
    `SELECT status, expires_at FROM platform_impersonation_sessions WHERE id = $1`,
    [imp.sid]
  );
  const session = rows[0];
  if (
    !session ||
    session.status !== "active" ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    throw ApiError.unauthorized(
      "Support session has ended, expired, or been revoked"
    );
  }

  if (isAlwaysAllowed(req)) return next();

  if (imp.scope === "read_only" && !SAFE_METHODS.has(req.method)) {
    await recordSecurityEvent({
      action: "support.scope_blocked",
      actorId: imp.actorId,
      actorRole: "super_admin",
      institutionId: payload.institutionId,
      targetType: "user",
      targetId: payload.sub,
      detail: {
        scope: "read_only",
        method: req.method,
        path: req.path,
        targetEmail: payload.email,
      },
      ip: clientIp(req),
    });
    throw ApiError.forbidden(
      "This support session is read-only and cannot modify data"
    );
  }

  if (imp.scope === "module_limited") {
    const mod = moduleForPath(req.path);
    if (mod !== "overview" && !(imp.modules ?? []).includes(mod)) {
      await recordSecurityEvent({
        action: "support.scope_blocked",
        actorId: imp.actorId,
        actorRole: "super_admin",
        institutionId: payload.institutionId,
        targetType: "user",
        targetId: payload.sub,
        detail: {
          scope: "module_limited",
          module: mod,
          allowed: imp.modules ?? [],
          method: req.method,
          path: req.path,
        },
        ip: clientIp(req),
      });
      throw ApiError.forbidden(
        "This module is not permitted in the current support session"
      );
    }
  }

  // write_enabled (and permitted module_limited paths) proceed as the target user,
  // constrained by the target's OWN tenant isolation + RBAC.
  return next();
}
