import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

/** Reads a single cookie from the raw header (avoids a cookie-parser dependency). */
export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction, // requires HTTPS in production
    sameSite: "lax",
    path: "/",
  };
}

const COOKIE_MAX_AGE_MS = env.jwtRefreshTtlDays * 24 * 60 * 60 * 1000;

/** Sets the portal's httpOnly access + refresh cookies. */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

/** Clears the portal auth cookies (logout / failed refresh). */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseOptions());
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}
