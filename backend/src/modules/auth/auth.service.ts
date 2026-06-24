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
} from "../../utils/jwt";
import { generateBase32Secret, otpauthUrl, verifyTotp } from "../../utils/totp";
import { hashPassword, verifyPassword } from "../../utils/password";
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

/** Either a full session, or a signal that a 2FA code is still required. */
export type LoginResult = AuthTokens | { twoFactorRequired: true };

async function issueTokens(user: UserRow): Promise<AuthTokens> {
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institution_id ?? null,
  });
  const { token: refreshToken, tokenHash } = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, refreshTokenExpiry()]
  );
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
  totpCode?: string
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
  // Second factor: only for users who have enrolled. A missing code is a soft
  // signal (not an error) so the client can prompt for it; a wrong code is 401.
  if (user.totp_enabled) {
    if (!totpCode) return { twoFactorRequired: true };
    if (!user.totp_secret || !verifyTotp(user.totp_secret, totpCode)) {
      throw ApiError.unauthorized("Invalid two-factor code");
    }
  }
  await purgeStaleRefreshTokens();
  return issueTokens(user);
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(refreshToken);
  const { rows } = await query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    "SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
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
  return issueTokens(user);
}

export async function logout(refreshToken: string): Promise<void> {
  await query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
    hashRefreshToken(refreshToken),
  ]);
}

export async function getProfile(userId: string) {
  const { rows } = await query<UserRow>(
    "SELECT id, email, full_name, role, phone, is_active, institution_id, totp_enabled FROM users WHERE id = $1",
    [userId]
  );
  const user = rows[0];
  if (!user) {
    throw ApiError.notFound("User not found");
  }
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    phone: user.phone,
    institutionId: user.institution_id ?? null,
    twoFactorEnabled: user.totp_enabled,
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
