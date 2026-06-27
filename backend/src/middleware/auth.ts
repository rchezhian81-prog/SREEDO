import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { ACCESS_COOKIE, getCookie } from "../utils/cookies";
import { verifyAccessToken } from "../utils/jwt";
import type { UserRole } from "../types";

/** Bearer header (staff) takes precedence; falls back to the portal's httpOnly cookie. */
function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return getCookie(req, ACCESS_COOKIE);
}

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = readAccessToken(req);
  if (!token) {
    throw ApiError.unauthorized();
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      institutionId: payload.institutionId ?? null,
      sessionId: payload.sid,
    };
    next();
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }
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
