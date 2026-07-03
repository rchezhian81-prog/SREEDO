import crypto from "node:crypto";
import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { hashPassword } from "../../utils/password";
import { sendMail, mailerConfigured } from "../../utils/mailer";
import { invalidatePlatformRoleCache } from "../../middleware/permissions";
import { recordAudit, type Actor } from "./platform.service";
import type {
  acceptInviteSchema,
  assignRoleSchema,
  inviteSchema,
  listAdminsQuerySchema,
  loginHistoryQuerySchema,
  reasonSchema,
  securityConfigSchema,
  setActiveSchema,
} from "./platform-admins.schema";

/**
 * Super Admin I — internal platform-team user management.
 *
 * A "platform user" is role='super_admin' AND institution_id IS NULL. This module
 * never touches tenant users. Every sensitive change is audited via
 * platform_audit_log; high-risk changes require a reason; the last active owner
 * can never be disabled, locked, or demoted; nothing is hard-deleted.
 *
 * platform_role classifies the team; full per-role permission ENFORCEMENT is the
 * separate RBAC module (H) — today all platform members authenticate as
 * super_admin.
 */

const PLATFORM_PRED = "u.role = 'super_admin' AND u.institution_id IS NULL";

type ListQuery = z.infer<typeof listAdminsQuerySchema>;
type InviteInput = z.infer<typeof inviteSchema>;
type AcceptInput = z.infer<typeof acceptInviteSchema>;
type AssignRoleInput = z.infer<typeof assignRoleSchema>;
type SetActiveInput = z.infer<typeof setActiveSchema>;
type ReasonInput = z.infer<typeof reasonSchema>;
type SecurityConfigInput = z.infer<typeof securityConfigSchema>;
type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;

interface PlatformUserRow {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  platform_role: string | null;
  totp_enabled: boolean;
  locked_until: Date | null;
}

/** Fetch a platform user (super_admin, no institution). 404 for anyone else. */
async function getPlatformUser(id: string): Promise<PlatformUserRow> {
  const { rows } = await query<PlatformUserRow>(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.platform_role,
            u.totp_enabled, u.locked_until
     FROM users u WHERE u.id = $1 AND ${PLATFORM_PRED}`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Platform admin not found");
  return rows[0];
}

/** How many owners can still operate (active). */
async function activeOwnerCount(): Promise<number> {
  const { rows } = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM users u
     WHERE ${PLATFORM_PRED} AND u.platform_role = 'owner' AND u.is_active = true`
  );
  return Number(rows[0].c);
}

/**
 * Block an action that would remove the last operational owner (disable, lock, or
 * demote). Safe to call before any of those three.
 */
async function assertNotLastOwner(target: PlatformUserRow, verb: string): Promise<void> {
  if (target.platform_role === "owner" && target.is_active && (await activeOwnerCount()) <= 1) {
    throw ApiError.badRequest(`Cannot ${verb} the last active owner`);
  }
}

/** Block acting on your own account for lockout-style actions. */
function assertNotSelf(actor: Actor, targetId: string, verb: string): void {
  if (actor.id === targetId) {
    throw ApiError.badRequest(`You cannot ${verb} your own account`);
  }
}

// ---- List / detail / summary ----

const SORT: Record<string, string> = {
  fullName: "u.full_name",
  email: "u.email",
  platformRole: "u.platform_role",
  createdAt: "u.created_at",
  lastLoginAt: "u.last_login_at",
};

const ADMIN_COLS = `
  u.id, u.full_name AS "fullName", u.email, u.platform_role AS "platformRole",
  u.is_active AS "isActive", u.totp_enabled AS "twoFactorEnabled",
  (u.locked_until IS NOT NULL AND u.locked_until > now()) AS "locked",
  u.locked_until AS "lockedUntil", u.failed_login_attempts AS "failedLoginAttempts",
  to_char(u.last_login_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastLoginAt",
  u.created_at AS "createdAt",
  (SELECT max(rt.last_used_at) FROM refresh_tokens rt
     WHERE rt.user_id = u.id AND rt.revoked_at IS NULL AND rt.expires_at > now()) AS "lastActivityAt",
  (SELECT count(*)::int FROM refresh_tokens rt
     WHERE rt.user_id = u.id AND rt.revoked_at IS NULL AND rt.expires_at > now()) AS "activeSessions"`;

export async function listPlatformAdmins(q: ListQuery) {
  const where: string[] = [PLATFORM_PRED];
  const params: unknown[] = [];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (q.platformRole) {
    params.push(q.platformRole);
    where.push(`u.platform_role = $${params.length}`);
  }
  if (q.status === "active") where.push("u.is_active = true AND (u.locked_until IS NULL OR u.locked_until <= now())");
  else if (q.status === "disabled") where.push("u.is_active = false");
  else if (q.status === "locked") where.push("u.locked_until IS NOT NULL AND u.locked_until > now()");

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM users u ${whereSql}`, params);
  const sortCol = SORT[q.sort] ?? "u.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${ADMIN_COLS} FROM users u ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, u.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export async function platformAdminDetail(id: string) {
  const { rows } = await query(
    `SELECT ${ADMIN_COLS} FROM users u WHERE u.id = $1 AND ${PLATFORM_PRED}`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Platform admin not found");
  return rows[0];
}

export async function platformAdminSummary() {
  const { rows } = await query<Record<string, number>>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE u.is_active AND (u.locked_until IS NULL OR u.locked_until <= now()))::int AS active,
       count(*) FILTER (WHERE NOT u.is_active)::int AS disabled,
       count(*) FILTER (WHERE u.locked_until IS NOT NULL AND u.locked_until > now())::int AS locked,
       count(*) FILTER (WHERE u.totp_enabled)::int AS "with2fa",
       count(*) FILTER (WHERE NOT u.totp_enabled)::int AS "without2fa",
       count(*) FILTER (WHERE u.platform_role = 'owner')::int AS owners
     FROM users u WHERE ${PLATFORM_PRED}`
  );
  const pending = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_invites WHERE status = 'pending' AND expires_at > now()`
  );
  return { ...rows[0], pendingInvites: Number(pending.rows[0].n) };
}

// ---- Invites ----

function inviteLinkBase(): string {
  return env.appPublicUrl ?? env.corsOrigin[0] ?? "";
}

export async function listInvites(status?: string) {
  const params: unknown[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE status = $1`;
  }
  const { rows } = await query(
    `SELECT id, email, platform_role AS "platformRole", full_name AS "fullName",
            status, expires_at AS "expiresAt", invited_by_email AS "invitedByEmail",
            accepted_at AS "acceptedAt", created_at AS "createdAt",
            (status = 'pending' AND expires_at <= now()) AS "isExpired"
     FROM platform_invites ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  return rows;
}

export async function invitePlatformAdmin(input: InviteInput, actor: Actor) {
  const existing = await query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [input.email]);
  if (existing.rows[0]) throw ApiError.conflict("A user with this email already exists");
  const pending = await query(
    "SELECT 1 FROM platform_invites WHERE lower(email) = lower($1) AND status = 'pending' AND expires_at > now()",
    [input.email]
  );
  if (pending.rows[0]) throw ApiError.conflict("An active invite already exists for this email");

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_invites
       (email, platform_role, full_name, token_hash, status, expires_at, invited_by, invited_by_email)
     VALUES ($1, $2, $3, $4, 'pending', now() + make_interval(days => $5::int), $6, $7)
     RETURNING id`,
    [input.email, input.platformRole, input.fullName ?? null, tokenHash, input.expiresInDays, actor.id, actor.email]
  );
  const emailSent = await sendInviteEmail(input.email, rawToken);
  await recordAudit(actor, {
    action: "platform.admin.invited",
    targetType: "platform_invite",
    targetId: rows[0].id,
    institutionId: null,
    detail: { email: input.email, platformRole: input.platformRole, emailSent },
  });
  return { id: rows[0].id, emailSent };
}

async function sendInviteEmail(email: string, rawToken: string): Promise<boolean> {
  const link = `${inviteLinkBase()}/platform-invite?token=${rawToken}`;
  await sendMail({
    to: email,
    subject: "You're invited to the GoCampusOS platform team",
    text:
      `You have been invited to join the GoCampusOS platform administration team.\n\n` +
      `Set up your account here (link expires soon):\n${link}\n\n` +
      `If you did not expect this, you can ignore this email.`,
  });
  return mailerConfigured();
}

export async function resendInvite(id: string, actor: Actor) {
  const { rows } = await query<{ email: string; status: string }>(
    "SELECT email, status FROM platform_invites WHERE id = $1",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Invite not found");
  if (rows[0].status !== "pending") throw ApiError.badRequest("Only a pending invite can be resent");
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await query(
    `UPDATE platform_invites
       SET token_hash = $2, expires_at = now() + interval '7 days'
     WHERE id = $1`,
    [id, tokenHash]
  );
  const emailSent = await sendInviteEmail(rows[0].email, rawToken);
  await recordAudit(actor, {
    action: "platform.admin.invite_resent",
    targetType: "platform_invite",
    targetId: id,
    institutionId: null,
    detail: { email: rows[0].email, emailSent },
  });
  return { emailSent };
}

export async function cancelInvite(id: string, actor: Actor) {
  const { rows } = await query<{ status: string; email: string }>(
    "SELECT status, email FROM platform_invites WHERE id = $1",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Invite not found");
  if (rows[0].status !== "pending") throw ApiError.badRequest("Only a pending invite can be cancelled");
  await query("UPDATE platform_invites SET status = 'cancelled' WHERE id = $1", [id]);
  await recordAudit(actor, {
    action: "platform.admin.invite_cancelled",
    targetType: "platform_invite",
    targetId: id,
    institutionId: null,
    detail: { email: rows[0].email },
  });
}

/** Public: accept an invite → creates the platform user. */
export async function acceptInvite(input: AcceptInput) {
  const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
  const { rows } = await query<{
    id: string;
    email: string;
    platform_role: string;
    status: string;
    expired: boolean;
  }>(
    `SELECT id, email, platform_role, status, (expires_at <= now()) AS expired
     FROM platform_invites WHERE token_hash = $1`,
    [tokenHash]
  );
  const invite = rows[0];
  if (!invite || invite.status !== "pending" || invite.expired) {
    throw ApiError.badRequest("This invite link is invalid or has expired");
  }
  const dup = await query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [invite.email]);
  if (dup.rows[0]) throw ApiError.conflict("A user with this email already exists");

  const passwordHash = await hashPassword(input.password);
  const userId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, platform_role)
       VALUES ($1, $2, $3, 'super_admin', true, $4) RETURNING id`,
      [invite.email, passwordHash, input.fullName, invite.platform_role]
    );
    await client.query(
      "UPDATE platform_invites SET status = 'accepted', accepted_user_id = $2, accepted_at = now() WHERE id = $1",
      [invite.id, ins.rows[0].id]
    );
    return ins.rows[0].id;
  });
  return { id: userId, email: invite.email };
}

// ---- Enable / disable / lock / unlock ----

export async function setActive(id: string, input: SetActiveInput, actor: Actor) {
  const target = await getPlatformUser(id);
  if (!input.isActive) {
    assertNotSelf(actor, id, "disable");
    await assertNotLastOwner(target, "disable");
  }
  await query("UPDATE users SET is_active = $2 WHERE id = $1", [id, input.isActive]);
  if (!input.isActive) {
    // Log the disabled admin out everywhere (revoke, don't delete — history kept).
    await query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [id]
    );
  }
  await recordAudit(actor, {
    action: input.isActive ? "platform.admin.enabled" : "platform.admin.disabled",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, reason: input.reason },
  });
  return platformAdminDetail(id);
}

/** Lock (indefinite admin lock) or unlock an account. */
export async function setLock(id: string, locked: boolean, input: ReasonInput, actor: Actor) {
  const target = await getPlatformUser(id);
  if (locked) {
    assertNotSelf(actor, id, "lock");
    await assertNotLastOwner(target, "lock");
    await query(
      "UPDATE users SET locked_until = now() + interval '100 years' WHERE id = $1",
      [id]
    );
    await query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [id]
    );
  } else {
    await query("UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = $1", [id]);
  }
  await recordAudit(actor, {
    action: locked ? "platform.admin.locked" : "platform.admin.unlocked",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, reason: input.reason },
  });
  return platformAdminDetail(id);
}

// ---- Role assignment ----

export async function assignRole(id: string, input: AssignRoleInput, actor: Actor) {
  const target = await getPlatformUser(id);
  if (target.platform_role === "owner" && input.platformRole !== "owner") {
    await assertNotLastOwner(target, "demote");
  }
  await query("UPDATE users SET platform_role = $2 WHERE id = $1", [id, input.platformRole]);
  invalidatePlatformRoleCache(id); // effective permissions change immediately
  await recordAudit(actor, {
    action: "platform.admin.role_changed",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, from: target.platform_role, to: input.platformRole, reason: input.reason },
  });
  return platformAdminDetail(id);
}

// ---- 2FA ----

export async function reset2fa(id: string, input: ReasonInput, actor: Actor) {
  const target = await getPlatformUser(id);
  await query("UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1", [id]);
  await recordAudit(actor, {
    action: "platform.admin.2fa_reset",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, reason: input.reason },
  });
  return platformAdminDetail(id);
}

export async function getSecurityConfig() {
  const { rows } = await query(
    `SELECT force_2fa_for_platform AS "force2faForPlatform",
            updated_by_email AS "updatedByEmail", updated_at AS "updatedAt"
     FROM platform_security_config WHERE id = TRUE`
  );
  return rows[0] ?? { force2faForPlatform: false, updatedByEmail: null, updatedAt: null };
}

export async function setSecurityConfig(input: SecurityConfigInput, actor: Actor) {
  await query(
    `INSERT INTO platform_security_config (id, force_2fa_for_platform, updated_by, updated_by_email, updated_at)
     VALUES (TRUE, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       force_2fa_for_platform = EXCLUDED.force_2fa_for_platform,
       updated_by = EXCLUDED.updated_by, updated_by_email = EXCLUDED.updated_by_email,
       updated_at = now()`,
    [input.force2faForPlatform, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "platform.security.config_update",
    targetType: "platform_security_config",
    targetId: null,
    institutionId: null,
    detail: { force2faForPlatform: input.force2faForPlatform, reason: input.reason },
  });
  return getSecurityConfig();
}

// ---- Sessions ----

export async function listAdminSessions(id: string) {
  await getPlatformUser(id);
  const { rows } = await query(
    `SELECT id, user_agent AS "userAgent", ip,
            created_at AS "createdAt", last_used_at AS "lastUsedAt"
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_used_at DESC`,
    [id]
  );
  return rows;
}

export async function revokeAdminSession(id: string, sessionId: string, actor: Actor) {
  const target = await getPlatformUser(id);
  const { rows } = await query<{ id: string }>(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [sessionId, id]
  );
  if (!rows[0]) throw ApiError.notFound("Session not found");
  await recordAudit(actor, {
    action: "platform.admin.session_revoked",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, sessionId },
  });
}

export async function revokeAllAdminSessions(id: string, actor: Actor) {
  const target = await getPlatformUser(id);
  const { rowCount } = await query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [id]
  );
  await recordAudit(actor, {
    action: "platform.admin.sessions_revoked_all",
    targetType: "user",
    targetId: id,
    institutionId: null,
    detail: { email: target.email, count: rowCount ?? 0 },
  });
  return { revoked: rowCount ?? 0 };
}

// ---- Login history (reads platform_audit_log auth.login.* events) ----

export async function loginHistory(q: LoginHistoryQuery) {
  const where: string[] = ["action LIKE 'auth.login.%'"];
  const params: unknown[] = [];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`actor_email ILIKE $${params.length}`);
  }
  if (q.outcome) {
    params.push(`auth.login.${q.outcome}`);
    where.push(`action = $${params.length}`);
  }
  if (q.dateFrom) {
    params.push(q.dateFrom);
    where.push(`created_at >= $${params.length}`);
  }
  if (q.dateTo) {
    params.push(q.dateTo);
    where.push(`created_at < ($${params.length}::date + interval '1 day')`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log ${whereSql}`,
    params
  );
  const { rows } = await query(
    `SELECT id, action, actor_id AS "actorId", actor_email AS "actorEmail", ip,
            detail->>'userAgent' AS "userAgent", detail->>'reason' AS "reason",
            (action = 'auth.login.success') AS success,
            created_at AS "createdAt"
     FROM platform_audit_log ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}
