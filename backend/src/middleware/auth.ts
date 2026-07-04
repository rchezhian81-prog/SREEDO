import type { NextFunction, Request, Response } from "express";
import { query } from "../db/postgres";
import { ApiError } from "../utils/api-error";
import { ACCESS_COOKIE, getCookie } from "../utils/cookies";
import { verifyAccessToken, type AccessTokenPayload } from "../utils/jwt";
import type { UserRole } from "../types";

/** Bearer header (staff) takes precedence; falls back to the portal's httpOnly cookie. */
function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return getCookie(req, ACCESS_COOKIE);
}

/** Read + verify the access token, or throw 401. */
function verifyRequestToken(req: Request): AccessTokenPayload {
  const token = readAccessToken(req);
  if (!token) {
    throw ApiError.unauthorized();
  }
  try {
    return verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }
}

/** Populate `req.user` from a verified access-token payload. */
function populateUser(req: Request, payload: AccessTokenPayload): void {
  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    institutionId: payload.institutionId ?? null,
    sessionId: payload.sid,
  };
  // Support-session context (null for every normal token). Exposes the token's
  // `imp` claim to downstream handlers; the keystone gate `enforceSupportScope`
  // already ran earlier on the api router.
  req.support = payload.imp ?? null;
}

/**
 * Per-request session-revocation check. A stateless JWT verify alone lets a
 * revoked session's access token keep working until it expires; this makes
 * revocation effective on the very next request. It costs one indexed PK lookup
 * per authenticated request (refresh_tokens.id is the primary key) — acceptable,
 * and deliberately NOT cached because revocation must be immediate.
 *
 * Safety: only a DEFINITIVE "row absent / revoked_at set / expired" rejects. A
 * transient DB error FAILS OPEN (logs + allows) so a database hiccup cannot lock
 * every admin out at once; the short access-token TTL bounds that exposure.
 */
async function assertSessionLive(sid: string): Promise<void> {
  let live: boolean;
  try {
    const { rows } = await query(
      "SELECT 1 FROM refresh_tokens WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()",
      [sid]
    );
    live = rows.length > 0;
  } catch (err) {
    // Fail-open: a DB outage must not lock everyone out (the 15m access TTL caps
    // the risk). Only a successful query with no matching row is a rejection.
    console.error("Session-revocation check failed (allowing request):", err);
    return;
  }
  if (!live) {
    throw ApiError.unauthorized("Session expired or revoked");
  }
}

/**
 * Authenticate a full session. Verifies the JWT, rejects a 2FA-setup-scoped token
 * (those may only reach the enrollment surface — see `authenticateSetup`), then
 * confirms the session behind the token has not been revoked/expired server-side.
 *
 * Async because of the revocation lookup: Express 5 forwards a rejected promise
 * from async middleware to the error handler, so throwing `ApiError` here is safe.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const payload = verifyRequestToken(req);
  // A setup-scoped token is confined to the enrollment surface; reject it on every
  // normal route (checked before the session lookup — setup tokens carry no sid).
  if (payload.scope === "2fa_setup") {
    throw ApiError.forbidden(
      "Two-factor setup required — finish enrolling to continue"
    );
  }
  populateUser(req, payload);
  // Legacy tokens (minted before sessions carried an id) have no sid → allow.
  if (payload.sid) {
    await assertSessionLive(payload.sid);
  }
  next();
}

/**
 * Like `authenticate`, but ALSO accepts a 2FA-setup-scoped token so a user who
 * must enrol can reach ONLY the enrollment surface (2FA status/setup/enable and
 * /auth/me). A setup token has no session row, so the revocation lookup is
 * skipped for it; a FULL token routed here still gets the revocation check. Every
 * other authenticated route keeps plain `authenticate`, which 403s a setup token.
 */
export async function authenticateSetup(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const payload = verifyRequestToken(req);
  populateUser(req, payload);
  if (payload.scope !== "2fa_setup" && payload.sid) {
    await assertSessionLive(payload.sid);
  }
  next();
}

/** Restricts a route to the given roles. Must run after `authenticate`. */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden();
    }
    next();
  };
}
