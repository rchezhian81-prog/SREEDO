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
  password: string
): Promise<AuthTokens> {
  const { rows } = await query<UserRow>(
    "SELECT * FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw ApiError.unauthorized("Invalid email or password");
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
    "SELECT id, email, full_name, role, phone, is_active, institution_id FROM users WHERE id = $1",
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
