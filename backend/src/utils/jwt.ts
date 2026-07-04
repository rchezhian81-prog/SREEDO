import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { SupportImpersonationClaim, UserRole } from "../types";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  institutionId: string | null;
  /** Refresh-token (session) id, so the API can flag the caller's own session. */
  sid?: string;
  /**
   * Scoped, setup-only token. A full login token has NO `scope`; a `"2fa_setup"`
   * token may reach ONLY the 2FA-enrollment surface (rejected everywhere else),
   * so a platform user whose role now mandates 2FA can enrol rather than dead-end.
   */
  scope?: "2fa_setup";
  /**
   * Support-access (impersonation) claim. Present ONLY on tokens issued for a
   * governed support session; its presence lets `enforceSupportScope` gate the
   * request while the target's own sub/email/role/institutionId keep tenant
   * isolation + RBAC intact. Normal tokens never carry it.
   */
  imp?: SupportImpersonationClaim;
}

/**
 * Signs an access token. `options.expiresIn` overrides the default TTL — support
 * tokens use it so the token's own lifetime matches the session's `expiryMinutes`
 * (the DB session row remains the authoritative, revocable source of truth).
 */
export function signAccessToken(
  payload: AccessTokenPayload,
  options?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: options?.expiresIn ?? (env.jwtAccessTtl as SignOptions["expiresIn"]),
  });
}

/**
 * Sign a short-lived (15m) SCOPED token that only unlocks the 2FA-enrollment
 * surface. Deliberately carries no `sid` (no session row is minted for it) — the
 * user must finish enrolling and log in normally to obtain a full session.
 */
export function signSetupToken(
  payload: Omit<AccessTokenPayload, "sid" | "scope">
): string {
  return jwt.sign(
    { ...payload, scope: "2fa_setup" as const },
    env.jwtAccessSecret,
    { expiresIn: "15m" }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings (not JWTs) stored hashed in
 * PostgreSQL, so individual sessions can be revoked server-side.
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(48).toString("hex");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.jwtRefreshTtlDays * 24 * 60 * 60 * 1000);
}
