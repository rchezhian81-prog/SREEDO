import crypto from "node:crypto";
import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { sendMail } from "../../utils/mailer";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  signSetupToken,
} from "../../utils/jwt";
import { generateBase32Secret, otpauthUrl, verifyTotp } from "../../utils/totp";
import { hashPassword, verifyPassword } from "../../utils/password";
import { assertInstitutionActiveForLogin } from "../../middleware/institution-status";
import { isPlatformFeatureEnabledForTenant } from "../platform/feature-flag-runtime";
import type { UserRole } from "../../types";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  is_active: boolean;
  institution_id: string | null;
  /** Platform-team classification (owner/billing_admin/…); null for tenant users. */
  platform_role: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

/**
 * A scoped setup handshake: the platform user's role now mandates 2FA (grace
 * elapsed) but they have not enrolled, so instead of a full login they get a
 * short-lived setup-only token that unlocks ONLY the 2FA-enrollment surface.
 */
export interface TwoFactorSetupRequired {
  twoFactorSetupRequired: true;
  setupToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

/**
 * A full session, a signal that a 2FA code is still required, or a scoped 2FA
 * setup handshake for a user who must enrol before a full session is issued.
 */
export type LoginResult =
  | AuthTokens
  | { twoFactorRequired: true }
  | TwoFactorSetupRequired;

/** Per-request session metadata captured at login/refresh (e.g. the browser). */
export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

async function issueTokens(
  user: UserRow,
  meta?: SessionMeta
): Promise<AuthTokens> {
  // Insert the refresh-token row first so its id can be embedded in the access
  // token as the session id ("sid"), letting the API flag the caller's own
  // session in the active-sessions list.
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  const { rows } = await query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, tokenHash, refreshTokenExpiry(), meta?.userAgent ?? null, meta?.ip ?? null]
  );
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institution_id ?? null,
    sid: rows[0].id,
  });
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    },
  };
}

/**
 * Record a failed password attempt and, once the threshold is reached, lock the
 * account for the configured window. Per-account complement to the IP limiter.
 */
async function registerFailedLogin(user: UserRow): Promise<void> {
  const attempts = user.failed_login_attempts + 1;
  if (attempts >= env.authMaxFailedAttempts) {
    await query(
      `UPDATE users
       SET failed_login_attempts = $1,
           locked_until = now() + make_interval(mins => $2::int)
       WHERE id = $3`,
      [attempts, env.authLockoutMinutes, user.id]
    );
  } else {
    await query("UPDATE users SET failed_login_attempts = $1 WHERE id = $2", [
      attempts,
      user.id,
    ]);
  }
}

/** Clear the failed-attempt counter and any lock after a successful password. */
async function clearFailedLogins(user: UserRow): Promise<void> {
  if (user.failed_login_attempts === 0 && !user.locked_until) return;
  await query(
    "UPDATE users SET failed_login_attempts = 0, locked_until = null WHERE id = $1",
    [user.id]
  );
}

/**
 * Should this login be intercepted with a 2FA-setup handshake instead of a full
 * session? True only when the caller is a PLATFORM user (super_admin, no
 * institution) whose role — per the per-role policy OR the global
 * force_2fa_for_platform switch — REQUIRES 2FA, whose grace window has elapsed,
 * and who has not enrolled. Reuses Phase 1's exact non-compliance predicate.
 *
 * ABSOLUTE lockout guard: the LAST active owner is never intercepted — an owner
 * who is the sole operator always logs in normally, so 2FA policy can never
 * lock the platform out of itself.
 */
async function requires2faSetupHandshake(user: UserRow): Promise<boolean> {
  if (user.role !== "super_admin" || user.institution_id !== null) return false;
  if (user.totp_enabled) return false;
  const { rows } = await query<{ non_compliant: boolean }>(
    `SELECT (
        (COALESCE(p.require_2fa, false) OR COALESCE(c.force_2fa_for_platform, false))
        AND (p.grace_until IS NULL OR p.grace_until < current_date)
      ) AS non_compliant
     FROM users u
     LEFT JOIN security_2fa_policy p ON p.role_key = u.platform_role
     LEFT JOIN platform_security_config c ON c.id = TRUE
     WHERE u.id = $1`,
    [user.id]
  );
  if (!rows[0]?.non_compliant) return false;
  // Never block the last active owner (absolute lockout guard).
  if (user.platform_role === "owner") {
    const { rows: owners } = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM users
       WHERE role = 'super_admin' AND institution_id IS NULL
         AND platform_role = 'owner' AND is_active = true`
    );
    if (Number(owners[0].c) <= 1) return false;
  }
  return true;
}

/** Housekeeping: drop expired tokens and revoked ones past the detection window. */
async function purgeStaleRefreshTokens(): Promise<void> {
  await query(
    `DELETE FROM refresh_tokens
     WHERE expires_at < now()
        OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '2 days')`
  );
}

export async function login(
  email: string,
  password: string,
  totpCode?: string,
  meta?: SessionMeta
): Promise<LoginResult> {
  const { rows } = await query<UserRow>(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  // Per-account lock: reject early (before checking the password) while active.
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(
      423,
      "Account locked after too many failed attempts. Try again later or contact an administrator."
    );
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await registerFailedLogin(user);
    throw ApiError.unauthorized("Invalid email or password");
  }
  // Password is correct — clear any prior failed-attempt counter / stale lock.
  await clearFailedLogins(user);
  // Tenant suspension (PR-SEC2): block a suspended institution's users AFTER their
  // credentials are verified (so suspension never leaks to a wrong-password probe)
  // and before any token is issued. super_admin (no institution) is exempt; the
  // kill-switch (OFF by default) makes this a no-op until an operator enables it.
  await assertInstitutionActiveForLogin(
    { id: user.id, email: user.email, role: user.role, institution_id: user.institution_id ?? null },
    meta?.ip ?? null
  );
  // Second factor: only for users who have enrolled. A missing code is a soft
  // signal (not an error) so the client can prompt for it; a wrong code is 401.
  if (user.totp_enabled) {
    if (!totpCode) return { twoFactorRequired: true };
    if (!user.totp_secret || !verifyTotp(user.totp_secret, totpCode)) {
      throw ApiError.unauthorized("Invalid two-factor code");
    }
  }
  // Enrollment gate: a platform user whose role now mandates 2FA (grace elapsed)
  // and who hasn't enrolled gets a scoped setup-only session — never a dead end,
  // and never the last active owner. No refresh token / session row is minted.
  if (await requires2faSetupHandshake(user)) {
    return {
      twoFactorSetupRequired: true,
      setupToken: signSetupToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        institutionId: user.institution_id ?? null,
      }),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
    };
  }
  await purgeStaleRefreshTokens();
  // Record the successful sign-in time (platform admin console surfaces this).
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
  return issueTokens(user, meta);
}

export async function refresh(
  refreshToken: string,
  meta?: SessionMeta
): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(refreshToken);
  const { rows } = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    user_agent: string | null;
  }>(
    "SELECT id, user_id, expires_at, revoked_at, user_agent FROM refresh_tokens WHERE token_hash = $1",
    [tokenHash]
  );
  const stored = rows[0];
  if (!stored) {
    throw ApiError.unauthorized("Invalid refresh token");
  }
  // Reuse detection: an already-rotated (revoked) token being presented again
  // signals theft — revoke every session for that user.
  if (stored.revoked_at) {
    await query("DELETE FROM refresh_tokens WHERE user_id = $1", [
      stored.user_id,
    ]);
    throw ApiError.unauthorized(
      "Refresh token reuse detected — please sign in again"
    );
  }
  if (new Date(stored.expires_at) < new Date()) {
    await query("DELETE FROM refresh_tokens WHERE id = $1", [stored.id]);
    throw ApiError.unauthorized("Refresh token expired");
  }
  // Rotate: mark this token revoked (retained briefly for reuse detection).
  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [
    stored.id,
  ]);
  const { rows: userRows } = await query<UserRow>(
    "SELECT * FROM users WHERE id = $1 AND is_active = true",
    [stored.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw ApiError.unauthorized("User no longer active");
  }
  // Carry the session's device label across rotation so it keeps its identity.
  return issueTokens(user, {
    userAgent: stored.user_agent ?? meta?.userAgent ?? null,
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
    hashRefreshToken(refreshToken),
  ]);
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

/** Active (non-revoked, unexpired) sessions for a user, newest activity first. */
export async function listSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionInfo[]> {
  const { rows } = await query<Omit<SessionInfo, "current">>(
    `SELECT id, user_agent AS "userAgent", created_at AS "createdAt",
            last_used_at AS "lastUsedAt"
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_used_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    ...row,
    current: !!currentSessionId && row.id === currentSessionId,
  }));
}

/** Revoke one of the user's own sessions (sign out that device). */
export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM refresh_tokens WHERE id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  if (!rowCount) throw ApiError.notFound("Session not found");
}

/**
 * Normalise the tenant's `enabledModules` setting to a list of enabled module
 * keys. Tolerates both shapes in use across the app: an array of keys (admin
 * console) or an object map `{key: boolean}` (tenant module). Returns null when
 * unset → callers treat that as "all modules enabled" (backward compatible).
 */
function normalizeEnabledModules(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v !== false)
      .map(([k]) => k);
  }
  return null;
}

export async function getProfile(userId: string) {
  const { rows } = await query<
    UserRow & { institution_type: "school" | "college" | null; enabled_modules: unknown }
  >(
    `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.is_active,
            u.institution_id, u.totp_enabled, i.type AS institution_type,
            i.settings -> 'enabledModules' AS enabled_modules
     FROM users u
     LEFT JOIN institutions i ON i.id = u.institution_id
     WHERE u.id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user) {
    throw ApiError.notFound("User not found");
  }
  // PR-UI2: server-derived effective boolean for the `ui_v2` skin flag, resolved
  // from the audited platform_feature_flags registry using ONLY the caller's own
  // institution id. Fail-safe to false. No raw flag / allowed_tenants / settings
  // is ever exposed — only this boolean.
  const uiV2Enabled = user.institution_id
    ? await isPlatformFeatureEnabledForTenant(user.institution_id, "ui_v2").catch(() => false)
    : false;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    phone: user.phone,
    institutionId: user.institution_id ?? null,
    institutionType: user.institution_type ?? null,
    enabledModules: normalizeEnabledModules(user.enabled_modules),
    twoFactorEnabled: user.totp_enabled,
    uiV2Enabled,
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const { rows } = await query<UserRow>(
    "SELECT * FROM users WHERE id = $1",
    [userId]
  );
  const user = rows[0];
  if (!user) {
    throw ApiError.notFound("User not found");
  }
  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    throw ApiError.badRequest("Current password is incorrect");
  }
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    await hashPassword(newPassword),
    userId,
  ]);
  // Invalidate every existing session after a password change.
  await query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
}

// --- Self-service password reset ----------------------------------------------

/** Opaque reset token; only its SHA-256 hash is ever stored (raw token emailed). */
function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

function resetTokenExpiry(): Date {
  return new Date(Date.now() + env.passwordResetTtlMinutes * 60 * 1000);
}

/**
 * Begin a self-service password reset. Always resolves and never reveals whether
 * the email exists (no account enumeration). When the account exists and is
 * active, a single-use token is stored (hashed) and a reset link is emailed
 * best-effort — a missing SMTP config or a send failure never fails the request.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { rows } = await query<UserRow>(
    "SELECT id, email, full_name, is_active FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    return; // silent no-op — do not leak whether the account exists
  }

  // Invalidate any outstanding unused tokens before issuing a fresh one.
  await query(
    "DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
    [user.id]
  );
  const { token, tokenHash } = generateResetToken();
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, resetTokenExpiry()]
  );

  const base = (env.appPublicUrl ?? env.corsOrigin[0] ?? "http://localhost:3000")
    .replace(/\/$/, "");
  const resetUrl = `${base}/reset-password?token=${token}`;
  const minutes = env.passwordResetTtlMinutes;
  await sendMail({
    to: user.email,
    subject: "Reset your GoCampus password",
    text:
      `Hello ${user.full_name},\n\n` +
      `We received a request to reset your GoCampus password. Use the link ` +
      `below within ${minutes} minutes to choose a new password:\n\n` +
      `${resetUrl}\n\n` +
      `If you didn't request this, you can safely ignore this email — your ` +
      `password will not change.\n`,
    html:
      `<p>Hello ${user.full_name},</p>` +
      `<p>We received a request to reset your GoCampus password. Use the link ` +
      `below within <strong>${minutes} minutes</strong> to choose a new ` +
      `password:</p>` +
      `<p><a href="${resetUrl}">Reset my password</a></p>` +
      `<p>If you didn't request this, you can safely ignore this email — your ` +
      `password will not change.</p>`,
  });
}

/**
 * Complete a password reset with a token from the emailed link. Validates the
 * token (exists, unused, unexpired), sets the new password, marks the token
 * used, and revokes every existing session and outstanding reset token for the
 * user — all in one transaction.
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { rows } = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens WHERE token_hash = $1`,
    [tokenHash]
  );
  const stored = rows[0];
  if (!stored || stored.used_at || new Date(stored.expires_at) < new Date()) {
    throw ApiError.badRequest("This reset link is invalid or has expired");
  }
  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      newHash,
      stored.user_id,
    ]);
    await client.query(
      "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1",
      [stored.id]
    );
    // Invalidate other outstanding reset tokens and every active session.
    await client.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
      [stored.user_id]
    );
    await client.query("DELETE FROM refresh_tokens WHERE user_id = $1", [
      stored.user_id,
    ]);
  });
}

// --- Two-factor authentication (TOTP) -----------------------------------------

export async function twoFactorStatus(
  userId: string
): Promise<{ enabled: boolean }> {
  const { rows } = await query<{ totp_enabled: boolean }>(
    "SELECT totp_enabled FROM users WHERE id = $1",
    [userId]
  );
  if (!rows[0]) throw ApiError.notFound("User not found");
  return { enabled: rows[0].totp_enabled };
}

/**
 * Begin enrollment: store a fresh (pending) secret and return it plus an
 * otpauth:// URI to add to an authenticator app. Not active until confirmed.
 */
export async function beginTwoFactorSetup(
  userId: string
): Promise<{ secret: string; otpauthUrl: string }> {
  const { rows } = await query<UserRow>("SELECT * FROM users WHERE id = $1", [
    userId,
  ]);
  const user = rows[0];
  if (!user) throw ApiError.notFound("User not found");
  if (user.totp_enabled) {
    throw ApiError.badRequest("Two-factor authentication is already enabled");
  }
  const secret = generateBase32Secret();
  await query(
    "UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2",
    [secret, userId]
  );
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Confirm a code against the pending secret and turn 2FA on. */
export async function enableTwoFactor(
  userId: string,
  code: string
): Promise<void> {
  const { rows } = await query<UserRow>("SELECT * FROM users WHERE id = $1", [
    userId,
  ]);
  const user = rows[0];
  if (!user) throw ApiError.notFound("User not found");
  if (!user.totp_secret) {
    throw ApiError.badRequest("Start two-factor setup first");
  }
  if (!verifyTotp(user.totp_secret, code)) {
    throw ApiError.badRequest("Invalid two-factor code");
  }
  await query("UPDATE users SET totp_enabled = true WHERE id = $1", [userId]);
}

/** Disable 2FA after confirming the account password. */
export async function disableTwoFactor(
  userId: string,
  password: string
): Promise<void> {
  const { rows } = await query<UserRow>("SELECT * FROM users WHERE id = $1", [
    userId,
  ]);
  const user = rows[0];
  if (!user) throw ApiError.notFound("User not found");
  if (!(await verifyPassword(password, user.password_hash))) {
    throw ApiError.badRequest("Password is incorrect");
  }
  await query(
    "UPDATE users SET totp_secret = null, totp_enabled = false WHERE id = $1",
    [userId]
  );
}
