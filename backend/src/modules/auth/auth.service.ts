import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
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
