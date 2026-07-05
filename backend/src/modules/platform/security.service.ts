import crypto from "node:crypto";
import type { z } from "zod";
import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { recordAudit, type Actor } from "./platform.service";
import { setLock } from "./platform-admins.service";
import type {
  apiTokenCreateSchema,
  complianceReportQuerySchema,
  dashboardQuerySchema,
  failedSummaryQuerySchema,
  highRiskQuerySchema,
  ipAllowlistAddSchema,
  ipAllowlistToggleSchema,
  loginHistoryQuerySchema,
  passwordPolicySchema,
  revokeRoleSchema,
  sessionsQuerySchema,
  twoFaComplianceQuerySchema,
  twoFaPolicySchema,
} from "./security.schema";

/**
 * Super Admin P — Platform Security & Compliance Center (service layer).
 *
 * A read/govern layer over the EXISTING security primitives — it never invents a
 * parallel store. Sessions are `refresh_tokens`; login/security events and the
 * high-risk feed are `platform_audit_log`; 2FA status is `users.totp_enabled`;
 * lockout is `users.locked_until`. New, additive state (per-role 2FA policy, IP
 * allowlist, API tokens, password-policy summary) lives in the 0094 tables and
 * defaults to "empty = safe".
 *
 * Rules honoured throughout: only platform users (super_admin, no institution)
 * are in scope; every mutation is audited; secrets (totp_secret, token_hash,
 * refresh-token values, password hashes) are NEVER selected into a response; the
 * last active owner is protected (lock/unlock reuse the module-I guards); nothing
 * security/audit/user history is hard-deleted.
 */

const PLATFORM_PRED = "u.role = 'super_admin' AND u.institution_id IS NULL";

const BUILT_IN_ROLE_KEYS = new Set([
  "owner",
  "platform_admin",
  "support_operator",
  "billing_admin",
  "auditor",
  "technical_admin",
]);

type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
type TwoFaPolicyInput = z.infer<typeof twoFaPolicySchema>;
type TwoFaComplianceQuery = z.infer<typeof twoFaComplianceQuerySchema>;
type SessionsQuery = z.infer<typeof sessionsQuerySchema>;
type RevokeRoleInput = z.infer<typeof revokeRoleSchema>;
type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;
type FailedSummaryQuery = z.infer<typeof failedSummaryQuerySchema>;
type PasswordPolicyInput = z.infer<typeof passwordPolicySchema>;
type IpAddInput = z.infer<typeof ipAllowlistAddSchema>;
type IpToggleInput = z.infer<typeof ipAllowlistToggleSchema>;
type ApiTokenInput = z.infer<typeof apiTokenCreateSchema>;
type HighRiskQuery = z.infer<typeof highRiskQuerySchema>;
type ComplianceQuery = z.infer<typeof complianceReportQuerySchema>;

// The curated definition of "high-risk" platform actions in platform_audit_log.
const HIGH_RISK_SQL = `(
  action ~ '^(rbac|impersonate|backup|restore|security|export)\\.'
  OR action LIKE 'platform.admin.%'
  OR action LIKE 'platform.security.%'
  OR action LIKE 'platform.settings%'
  OR action IN (
    'institution.suspend','subscription.assign','subscription.config_update',
    'invoice.voided','invoice.settings_changed','payment_gateway.settings_changed',
    'platform.audit_exported','platform.institutions_exported',
    'invoice.exported','invoice.report_exported'
  )
)`;

const CATEGORY_SQL: Record<string, string> = {
  rbac: "action LIKE 'rbac.%'",
  admins: "action LIKE 'platform.admin.%'",
  impersonation: "action LIKE 'impersonate.%'",
  backups: "(action LIKE 'backup.%' OR action LIKE 'restore.%')",
  billing:
    "action IN ('invoice.voided','invoice.settings_changed','payment_gateway.settings_changed','subscription.assign','subscription.config_update')",
  settings: "(action LIKE 'platform.settings%' OR action LIKE 'platform.security.%')",
  exports: "(action LIKE '%_exported' OR action LIKE '%.exported')",
};

/** Append a created_at window clause; returns the SQL fragment. Missing/`custom`
 *  window falls back to the explicit date range (or all rows). */
function windowClause(
  col: string,
  q: { window?: string; dateFrom?: string; dateTo?: string },
  params: unknown[]
): string {
  if (q.window === "today") return `${col} >= date_trunc('day', now())`;
  if (q.window === "7d") return `${col} >= now() - interval '7 days'`;
  if (q.window === "30d") return `${col} >= now() - interval '30 days'`;
  const parts: string[] = [];
  if (q.dateFrom) {
    params.push(q.dateFrom);
    parts.push(`${col} >= $${params.length}`);
  }
  if (q.dateTo) {
    params.push(q.dateTo);
    parts.push(`${col} < ($${params.length}::date + interval '1 day')`);
  }
  return parts.length ? parts.join(" AND ") : "TRUE";
}

async function assertValidRoleKey(roleKey: string): Promise<void> {
  if (BUILT_IN_ROLE_KEYS.has(roleKey)) return;
  const { rows } = await query("SELECT 1 FROM rbac_roles WHERE key = $1 AND status <> 'archived'", [
    roleKey,
  ]);
  if (!rows[0]) throw ApiError.badRequest("Unknown role");
}

// ============================ A. Dashboard ============================

export async function dashboardSummary(q: DashboardQuery) {
  const params: unknown[] = [];
  const w = windowClause("created_at", q, params);

  const admins = await query<Record<string, number>>(
    `SELECT
       count(*)::int AS "platformAdminsTotal",
       count(*) FILTER (WHERE NOT u.totp_enabled)::int AS "platformAdminsWithout2fa",
       count(*) FILTER (WHERE NOT u.is_active)::int AS "disabledPlatformAdmins",
       count(*) FILTER (WHERE u.locked_until IS NOT NULL AND u.locked_until > now())::int AS "lockedAccounts",
       count(*) FILTER (WHERE u.platform_role = 'owner' AND NOT u.totp_enabled)::int AS "ownersWithout2fa"
     FROM users u WHERE ${PLATFORM_PRED}`
  );

  const sessions = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.revoked_at IS NULL AND rt.expires_at > now() AND ${PLATFORM_PRED}`
  );

  const logins = await query<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE action='auth.login.failed' AND created_at >= date_trunc('day', now()))::int AS "failedLoginsToday",
       count(*) FILTER (WHERE action='auth.login.failed' AND created_at >= now() - interval '7 days')::int AS "failedLoginsWeek"
     FROM platform_audit_log`
  );

  // Suspicious = an IP with 5+ failed logins in the last 24h.
  const suspicious = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM (
       SELECT ip FROM platform_audit_log
       WHERE action='auth.login.failed' AND ip IS NOT NULL AND created_at >= now() - interval '24 hours'
       GROUP BY ip HAVING count(*) >= 5
     ) s`
  );

  const support = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_impersonation_sessions
     WHERE ended_at IS NULL AND expires_at > now()`
  );

  const recent = await query<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE action LIKE 'rbac.%' AND ${w})::int AS "recentHighRiskRbac",
       count(*) FILTER (WHERE ${HIGH_RISK_SQL} AND ${w})::int AS "recentHighRiskAudit",
       count(*) FILTER (WHERE action='platform.admin.2fa_reset' AND ${w})::int AS "recent2faResets",
       count(*) FILTER (WHERE (action IN ('platform.admin.session_revoked','platform.admin.sessions_revoked_all')
              OR action LIKE 'security.%revoked%') AND ${w})::int AS "recentSessionRevocations",
       max(created_at) FILTER (WHERE action LIKE '%_exported' OR action LIKE '%.exported') AS "lastExportAt"
     FROM platform_audit_log`,
    params
  );

  const tokens = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_api_tokens
     WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
  );

  return {
    window: q.window,
    ...admins.rows[0],
    activePlatformSessions: Number(sessions.rows[0].n),
    ...logins.rows[0],
    suspiciousLoginAttempts: Number(suspicious.rows[0].n),
    activeSupportSessions: Number(support.rows[0].n),
    ...recent.rows[0],
    apiTokensActive: Number(tokens.rows[0].n),
  };
}

// ============================ B. 2FA policy ============================

async function forcePlatform2fa(): Promise<boolean> {
  const { rows } = await query<{ f: boolean }>(
    "SELECT force_2fa_for_platform AS f FROM platform_security_config WHERE id = TRUE"
  );
  return Boolean(rows[0]?.f);
}

export async function get2faPolicy() {
  const force = await forcePlatform2fa();
  const { rows } = await query(
    `SELECT r.key AS "roleKey", r.name, r.kind, r.is_owner AS "isOwner",
            COALESCE(p.require_2fa, false) AS "require2fa",
            p.grace_until AS "graceUntil",
            p.updated_by_email AS "updatedByEmail", p.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM users u
               WHERE ${PLATFORM_PRED} AND u.platform_role = r.key) AS "usersInRole",
            (SELECT count(*)::int FROM users u
               WHERE ${PLATFORM_PRED} AND u.platform_role = r.key AND NOT u.totp_enabled) AS "usersWithout2fa"
     FROM rbac_roles r
     LEFT JOIN security_2fa_policy p ON p.role_key = r.key
     WHERE r.status <> 'archived'
     ORDER BY r.is_owner DESC, r.kind, r.name`
  );
  return { forcePlatform: force, roles: rows };
}

export async function set2faPolicy(input: TwoFaPolicyInput, actor: Actor) {
  await assertValidRoleKey(input.roleKey);
  await query(
    `INSERT INTO security_2fa_policy (role_key, require_2fa, grace_until, updated_by, updated_by_email, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (role_key) DO UPDATE SET
       require_2fa = EXCLUDED.require_2fa, grace_until = EXCLUDED.grace_until,
       updated_by = EXCLUDED.updated_by, updated_by_email = EXCLUDED.updated_by_email, updated_at = now()`,
    [input.roleKey, input.require2fa, input.graceUntil ?? null, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "security.2fa_policy_updated",
    targetType: "security_2fa_policy",
    targetId: null,
    institutionId: null,
    detail: {
      roleKey: input.roleKey,
      require2fa: input.require2fa,
      graceUntil: input.graceUntil ?? null,
      reason: input.reason ?? null,
    },
  });
  return get2faPolicy();
}

export async function twoFaCompliance(q: TwoFaComplianceQuery) {
  const params: unknown[] = [];
  const filters: string[] = [PLATFORM_PRED];
  if (q.q) {
    params.push(`%${q.q}%`);
    filters.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const baseSql = `
    SELECT u.id, u.full_name AS "fullName", u.email, u.platform_role AS "platformRole",
           u.totp_enabled AS "twoFactorEnabled", (u.platform_role = 'owner') AS "isOwner",
           (COALESCE(p.require_2fa, false) OR COALESCE(c.force_2fa_for_platform, false)) AS required,
           p.grace_until AS "graceUntil",
           CASE
             WHEN u.totp_enabled THEN 'compliant'
             WHEN NOT (COALESCE(p.require_2fa, false) OR COALESCE(c.force_2fa_for_platform, false)) THEN 'exempt'
             WHEN p.grace_until IS NOT NULL AND p.grace_until >= current_date THEN 'grace'
             ELSE 'non_compliant'
           END AS state
    FROM users u
    LEFT JOIN security_2fa_policy p ON p.role_key = u.platform_role
    LEFT JOIN platform_security_config c ON c.id = TRUE
    WHERE ${filters.join(" AND ")}`;

  let stateFilter = "";
  if (q.status !== "all") {
    params.push(q.status);
    stateFilter = ` WHERE sub.state = $${params.length}`;
  }
  const wrapped = `SELECT * FROM (${baseSql}) sub${stateFilter}`;
  const count = await query<{ n: number }>(`SELECT count(*)::int AS n FROM (${wrapped}) c2`, params);
  const { rows } = await query(
    `${wrapped} ORDER BY (sub.state = 'non_compliant') DESC, sub."fullName"
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

// ============================ C. Sessions ============================

export async function listAllSessions(q: SessionsQuery) {
  const params: unknown[] = [];
  const where: string[] = [
    "rt.revoked_at IS NULL",
    "rt.expires_at > now()",
    PLATFORM_PRED,
  ];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (q.role) {
    params.push(q.role);
    where.push(`u.platform_role = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id ${whereSql}`,
    params
  );
  const { rows } = await query(
    `SELECT rt.id, rt.user_id AS "userId", u.full_name AS "userName", u.email,
            u.platform_role AS "platformRole", rt.user_agent AS "userAgent", rt.ip,
            rt.created_at AS "createdAt", rt.last_used_at AS "lastUsedAt"
     FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id ${whereSql}
     ORDER BY rt.last_used_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export async function revokeSession(sessionId: string, reason: string, actor: Actor) {
  const { rows } = await query<{ user_id: string; email: string }>(
    `UPDATE refresh_tokens rt SET revoked_at = now()
     FROM users u
     WHERE rt.id = $1 AND rt.user_id = u.id AND ${PLATFORM_PRED} AND rt.revoked_at IS NULL
     RETURNING rt.user_id, u.email`,
    [sessionId]
  );
  if (!rows[0]) throw ApiError.notFound("Session not found");
  await recordAudit(actor, {
    action: "security.session_revoked",
    targetType: "user",
    targetId: rows[0].user_id,
    institutionId: null,
    detail: { email: rows[0].email, sessionId, reason },
  });
  return { revoked: 1 };
}

export async function revokeUserSessions(
  userId: string,
  reason: string,
  actor: Actor,
  exceptSessionId?: string | null
) {
  const target = await query<{ email: string }>(
    `SELECT u.email FROM users u WHERE u.id = $1 AND ${PLATFORM_PRED}`,
    [userId]
  );
  if (!target.rows[0]) throw ApiError.notFound("Platform admin not found");
  const params: unknown[] = [userId];
  let extra = "";
  if (exceptSessionId) {
    params.push(exceptSessionId);
    extra = ` AND id <> $${params.length}`;
  }
  const { rowCount } = await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL${extra}`,
    params
  );
  await recordAudit(actor, {
    action: "security.user_sessions_revoked",
    targetType: "user",
    targetId: userId,
    institutionId: null,
    detail: { email: target.rows[0].email, count: rowCount ?? 0, reason },
  });
  return { revoked: rowCount ?? 0 };
}

export async function revokeRoleSessions(
  input: RevokeRoleInput,
  actor: Actor,
  exceptSessionId?: string | null
) {
  await assertValidRoleKey(input.roleKey);
  const params: unknown[] = [input.roleKey];
  let extra = "";
  if (exceptSessionId) {
    params.push(exceptSessionId);
    extra = ` AND rt.id <> $${params.length}`;
  }
  // Exclude the acting owner's current session (prevent accidental self-lockout).
  const { rowCount } = await query(
    `UPDATE refresh_tokens rt SET revoked_at = now()
     FROM users u
     WHERE rt.user_id = u.id AND ${PLATFORM_PRED} AND u.platform_role = $1
       AND rt.revoked_at IS NULL${extra}`,
    params
  );
  await recordAudit(actor, {
    action: "security.role_sessions_revoked",
    targetType: "role",
    targetId: null,
    institutionId: null,
    detail: { roleKey: input.roleKey, count: rowCount ?? 0, reason: input.reason },
  });
  return { revoked: rowCount ?? 0 };
}

// ============================ D. Login history ============================

function loginHistoryWhere(q: LoginHistoryQuery, params: unknown[]): string {
  const where: string[] = ["action LIKE 'auth.login.%'"];
  if (q.scope === "platform") {
    where.push(
      `EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(platform_audit_log.actor_email)
               AND u.role = 'super_admin' AND u.institution_id IS NULL)`
    );
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`actor_email ILIKE $${params.length}`);
  }
  if (q.outcome) {
    params.push(`auth.login.${q.outcome}`);
    where.push(`action = $${params.length}`);
  }
  if (q.ip) {
    params.push(`%${q.ip}%`);
    where.push(`ip ILIKE $${params.length}`);
  }
  if (q.dateFrom) {
    params.push(q.dateFrom);
    where.push(`created_at >= $${params.length}`);
  }
  if (q.dateTo) {
    params.push(q.dateTo);
    where.push(`created_at < ($${params.length}::date + interval '1 day')`);
  }
  return `WHERE ${where.join(" AND ")}`;
}

export async function loginHistory(q: LoginHistoryQuery) {
  const params: unknown[] = [];
  const whereSql = loginHistoryWhere(q, params);
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log ${whereSql}`,
    params
  );
  const { rows } = await query(
    `SELECT id, action, actor_id AS "actorId", actor_email AS "actorEmail",
            actor_role AS "actorRole", ip, detail->>'userAgent' AS "userAgent",
            detail->>'reason' AS "reason", (action = 'auth.login.success') AS success,
            created_at AS "createdAt"
     FROM platform_audit_log ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export async function loginHistoryExportRows(q: LoginHistoryQuery) {
  const params: unknown[] = [];
  const whereSql = loginHistoryWhere(q, params);
  const { rows } = await query<Record<string, unknown>>(
    `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
            actor_email AS "actorEmail", actor_role AS "actorRole",
            CASE WHEN action='auth.login.success' THEN 'success' ELSE 'failed' END AS outcome,
            ip, detail->>'userAgent' AS "userAgent", detail->>'reason' AS "reason"
     FROM platform_audit_log ${whereSql}
     ORDER BY created_at DESC LIMIT 10000`,
    params
  );
  return rows;
}

export const LOGIN_HISTORY_COLUMNS = [
  { key: "createdAt", label: "Time" },
  { key: "actorEmail", label: "Email" },
  { key: "actorRole", label: "Role" },
  { key: "outcome", label: "Outcome" },
  { key: "ip", label: "IP address" },
  { key: "userAgent", label: "Device / user agent" },
  { key: "reason", label: "Failure reason" },
];

export async function failedLoginSummary(q: FailedSummaryQuery) {
  const params: unknown[] = [];
  const w = windowClause("created_at", q, params);
  const keyExpr =
    q.by === "ip"
      ? "COALESCE(ip, '(unknown)')"
      : q.by === "day"
        ? "to_char(date_trunc('day', created_at), 'YYYY-MM-DD')"
        : "COALESCE(actor_email, '(unknown)')";
  const { rows } = await query(
    `SELECT ${keyExpr} AS key, count(*)::int AS attempts,
            count(DISTINCT ip)::int AS "distinctIps",
            max(created_at) AS "lastAttemptAt"
     FROM platform_audit_log
     WHERE action = 'auth.login.failed' AND ${w}
     GROUP BY 1 ORDER BY attempts DESC, "lastAttemptAt" DESC LIMIT 100`,
    params
  );
  return { by: q.by, window: q.window, rows };
}

// ============================ E. Lockout ============================

export async function lockedAccounts() {
  const { rows } = await query(
    `SELECT u.id, u.full_name AS "fullName", u.email, u.platform_role AS "platformRole",
            u.locked_until AS "lockedUntil", u.failed_login_attempts AS "failedLoginAttempts",
            (u.locked_until > now() + interval '50 years') AS "manualLock",
            to_char(u.last_login_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastLoginAt"
     FROM users u
     WHERE ${PLATFORM_PRED} AND u.locked_until IS NOT NULL AND u.locked_until > now()
     ORDER BY u.locked_until DESC`
  );
  return rows.map((r) => ({
    ...r,
    lockReason: (r as { manualLock: boolean }).manualLock ? "manual" : "failed_attempts",
  }));
}

/** Lock/unlock reuse the module-I guards (last-owner + self protection + audit). */
export async function lockAccount(id: string, reason: string, actor: Actor) {
  return setLock(id, true, { reason }, actor);
}
export async function unlockAccount(id: string, reason: string, actor: Actor) {
  return setLock(id, false, { reason }, actor);
}

// ============================ F. Password policy ============================

export async function getPasswordPolicy() {
  const { rows } = await query<{
    minLength: number | null;
    requireComplexity: boolean | null;
    expiryDays: number | null;
  }>(
    `SELECT password_min_length AS "minLength",
            password_require_complexity AS "requireComplexity",
            password_expiry_days AS "expiryDays"
     FROM platform_security_config WHERE id = TRUE`
  );
  const row = rows[0];
  return {
    // Editable, audited policy summary (0094 config columns).
    minLength: row?.minLength ?? 8,
    requireComplexity: row?.requireComplexity ?? false,
    expiryDays: row?.expiryDays ?? null,
    // The baseline the auth engine enforces today (read-only facts).
    enforced: {
      minLength: 8,
      passwordResetTtlMinutes: env.passwordResetTtlMinutes,
      accessTokenTtl: env.jwtAccessTtl,
      refreshTokenTtlDays: env.jwtRefreshTtlDays,
      lockout: { maxFailedAttempts: env.authMaxFailedAttempts, lockoutMinutes: env.authLockoutMinutes },
    },
  };
}

export async function setPasswordPolicy(input: PasswordPolicyInput, actor: Actor) {
  await query(
    `INSERT INTO platform_security_config
       (id, password_min_length, password_require_complexity, password_expiry_days, updated_by, updated_by_email, updated_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       password_min_length = EXCLUDED.password_min_length,
       password_require_complexity = EXCLUDED.password_require_complexity,
       password_expiry_days = EXCLUDED.password_expiry_days,
       updated_by = EXCLUDED.updated_by, updated_by_email = EXCLUDED.updated_by_email, updated_at = now()`,
    [input.minLength, input.requireComplexity, input.expiryDays ?? null, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "security.password_policy_updated",
    targetType: "platform_security_config",
    targetId: null,
    institutionId: null,
    detail: {
      minLength: input.minLength,
      requireComplexity: input.requireComplexity,
      expiryDays: input.expiryDays ?? null,
      reason: input.reason ?? null,
    },
  });
  return getPasswordPolicy();
}

// ============================ G. IP allowlist ============================

/** Parse an IPv4 dotted string to a 32-bit int, or null if not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Does `ip` fall inside `entry` (an IPv4 addr/CIDR, or an exact string match)? */
export function ipMatches(ip: string, entry: string): boolean {
  const e = entry.trim();
  if (e === ip.trim()) return true;
  const slash = e.indexOf("/");
  if (slash === -1) return ipv4ToInt(e) !== null && ipv4ToInt(e) === ipv4ToInt(ip);
  const base = e.slice(0, slash);
  const bits = Number(e.slice(slash + 1));
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (a & mask) === (b & mask);
}

export async function ipAllowlistState(currentIp: string | null) {
  const { rows } = await query(
    `SELECT id, cidr, label, created_by_email AS "createdByEmail", created_at AS "createdAt"
     FROM platform_ip_allowlist ORDER BY created_at ASC`
  );
  const cfg = await query<{ enabled: boolean }>(
    "SELECT ip_allowlist_enabled AS enabled FROM platform_security_config WHERE id = TRUE"
  );
  const enabled = Boolean(cfg.rows[0]?.enabled);
  const currentAllowed = currentIp
    ? rows.some((r) => ipMatches(currentIp, (r as { cidr: string }).cidr))
    : false;
  return { enabled, currentIp, currentAllowed, entries: rows };
}

export async function isIpAllowed(ip: string | null): Promise<boolean> {
  const cfg = await query<{ enabled: boolean }>(
    "SELECT ip_allowlist_enabled AS enabled FROM platform_security_config WHERE id = TRUE"
  );
  if (!cfg.rows[0]?.enabled) return true; // disabled → allow (no-op)
  if (!ip) return false;
  const { rows } = await query<{ cidr: string }>("SELECT cidr FROM platform_ip_allowlist");
  if (rows.length === 0) return true; // enabled but empty → fail-open (never lock out)
  return rows.some((r) => ipMatches(ip, r.cidr));
}

export async function addIpAllowlistEntry(input: IpAddInput, actor: Actor) {
  const exists = await query("SELECT 1 FROM platform_ip_allowlist WHERE cidr = $1", [input.cidr]);
  if (exists.rows[0]) throw ApiError.conflict("That IP/CIDR is already on the allowlist");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_ip_allowlist (cidr, label, created_by, created_by_email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.cidr, input.label ?? "", actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "security.ip_allowlist_added",
    targetType: "platform_ip_allowlist",
    targetId: rows[0].id,
    institutionId: null,
    detail: { cidr: input.cidr, label: input.label ?? "" },
  });
  return ipAllowlistState(actor.ip);
}

export async function removeIpAllowlistEntry(id: string, actor: Actor) {
  const { rows } = await query<{ cidr: string }>(
    "DELETE FROM platform_ip_allowlist WHERE id = $1 RETURNING cidr",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Allowlist entry not found");
  await recordAudit(actor, {
    action: "security.ip_allowlist_removed",
    targetType: "platform_ip_allowlist",
    targetId: id,
    institutionId: null,
    detail: { cidr: rows[0].cidr },
  });
  return ipAllowlistState(actor.ip);
}

export async function setIpAllowlistEnabled(input: IpToggleInput, actor: Actor) {
  if (input.enabled) {
    // Refuse to enable a rule that would lock the caller out.
    const { rows } = await query<{ cidr: string }>("SELECT cidr FROM platform_ip_allowlist");
    if (rows.length === 0) {
      throw ApiError.badRequest("Add at least one allowed IP before enabling the allowlist");
    }
    if (!actor.ip || !rows.some((r) => ipMatches(actor.ip as string, r.cidr))) {
      throw ApiError.badRequest(
        `Your current IP (${actor.ip ?? "unknown"}) is not on the allowlist — add it first to avoid locking yourself out`
      );
    }
  }
  await query(
    `INSERT INTO platform_security_config (id, ip_allowlist_enabled, updated_by, updated_by_email, updated_at)
     VALUES (TRUE, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       ip_allowlist_enabled = EXCLUDED.ip_allowlist_enabled,
       updated_by = EXCLUDED.updated_by, updated_by_email = EXCLUDED.updated_by_email, updated_at = now()`,
    [input.enabled, actor.id, actor.email]
  );
  await recordAudit(actor, {
    action: "security.ip_allowlist_toggled",
    targetType: "platform_security_config",
    targetId: null,
    institutionId: null,
    detail: { enabled: input.enabled, reason: input.reason ?? null, ip: actor.ip },
  });
  return ipAllowlistState(actor.ip);
}

// ============================ H. API tokens ============================

const TOKEN_PREFIX = "gcp_";

function tokenStatus(row: { revoked_at: Date | null; expires_at: Date | null }): string {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return "expired";
  return "active";
}

export async function listApiTokens() {
  const { rows } = await query<{
    id: string;
    name: string;
    description: string;
    token_prefix: string;
    scopes: string[];
    created_by_email: string | null;
    expires_at: Date | null;
    last_used_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, name, description, token_prefix, scopes, created_by_email,
            expires_at, last_used_at, revoked_at, created_at
     FROM platform_api_tokens ORDER BY created_at DESC`
  );
  // token_hash is NEVER selected — no token value can leave this service.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    tokenPrefix: r.token_prefix,
    scopes: r.scopes,
    createdByEmail: r.created_by_email,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    status: tokenStatus(r),
  }));
}

/** insertToken only PERSISTS scopes (creation validates them via the schema), so
 *  it accepts a structural input — letting rotate reuse an existing token's
 *  already-validated `string[]` scopes without a redundant cast. */
type InsertTokenInput = {
  name: string;
  description?: string;
  scopes: readonly string[];
  expiresInDays?: number | null;
};

async function insertToken(input: InsertTokenInput, actor: Actor, rotatedFrom: string | null) {
  const raw = TOKEN_PREFIX + crypto.randomBytes(30).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 12);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_api_tokens
       (name, description, token_prefix, token_hash, scopes, created_by, created_by_email, expires_at, rotated_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(days => $8::int) END, $9)
     RETURNING id`,
    [
      input.name,
      input.description ?? "",
      prefix,
      tokenHash,
      input.scopes,
      actor.id,
      actor.email,
      input.expiresInDays ?? null,
      rotatedFrom,
    ]
  );
  return { id: rows[0].id, token: raw, prefix };
}

export async function createApiToken(input: ApiTokenInput, actor: Actor) {
  const created = await insertToken(input, actor, null);
  await recordAudit(actor, {
    action: "security.api_token_created",
    targetType: "platform_api_token",
    targetId: created.id,
    institutionId: null,
    detail: { name: input.name, scopes: input.scopes, prefix: created.prefix },
  });
  // The full token is returned ONCE here and never again.
  return { id: created.id, token: created.token, tokenPrefix: created.prefix };
}

export async function revokeApiToken(id: string, actor: Actor) {
  const { rows } = await query<{ name: string }>(
    "UPDATE platform_api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name",
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Token not found or already revoked");
  await recordAudit(actor, {
    action: "security.api_token_revoked",
    targetType: "platform_api_token",
    targetId: id,
    institutionId: null,
    detail: { name: rows[0].name },
  });
  return { revoked: true };
}

export async function rotateApiToken(id: string, actor: Actor) {
  const { rows } = await query<{
    name: string;
    description: string;
    scopes: string[];
    revoked_at: Date | null;
  }>("SELECT name, description, scopes, revoked_at FROM platform_api_tokens WHERE id = $1", [id]);
  const old = rows[0];
  if (!old) throw ApiError.notFound("Token not found");
  if (old.revoked_at) throw ApiError.badRequest("Cannot rotate a revoked token");
  await query("UPDATE platform_api_tokens SET revoked_at = now() WHERE id = $1", [id]);
  const created = await insertToken(
    { name: old.name, description: old.description, scopes: old.scopes, expiresInDays: null },
    actor,
    id
  );
  await recordAudit(actor, {
    action: "security.api_token_rotated",
    targetType: "platform_api_token",
    targetId: created.id,
    institutionId: null,
    detail: { name: old.name, rotatedFrom: id, prefix: created.prefix },
  });
  return { id: created.id, token: created.token, tokenPrefix: created.prefix };
}

// ============================ I. High-risk feed ============================

export async function highRiskFeed(q: HighRiskQuery) {
  const params: unknown[] = [];
  const where: string[] = [HIGH_RISK_SQL];
  where.push(windowClause("created_at", q, params));
  if (q.category !== "all" && CATEGORY_SQL[q.category]) where.push(CATEGORY_SQL[q.category]);
  if (q.actorId) {
    params.push(q.actorId);
    where.push(`actor_id = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(action ILIKE $${params.length} OR actor_email ILIKE $${params.length})`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log ${whereSql}`,
    params
  );
  const { rows } = await query(
    `SELECT id, action, actor_id AS "actorId", actor_email AS "actorEmail",
            actor_role AS "actorRole", target_type AS "targetType", target_id AS "targetId",
            ip, detail->>'reason' AS "reason", detail,
            (action LIKE '%.failed') AS failed,
            created_at AS "createdAt"
     FROM platform_audit_log ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export async function highRiskExportRows(q: HighRiskQuery) {
  const params: unknown[] = [];
  const where: string[] = [HIGH_RISK_SQL];
  where.push(windowClause("created_at", q, params));
  if (q.category !== "all" && CATEGORY_SQL[q.category]) where.push(CATEGORY_SQL[q.category]);
  if (q.actorId) {
    params.push(q.actorId);
    where.push(`actor_id = $${params.length}`);
  }
  const { rows } = await query<Record<string, unknown>>(
    `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
            action, actor_email AS "actorEmail", actor_role AS "actorRole",
            target_type AS "targetType", ip, detail->>'reason' AS "reason"
     FROM platform_audit_log WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC LIMIT 10000`,
    params
  );
  return rows;
}

export const HIGH_RISK_COLUMNS = [
  { key: "createdAt", label: "Time" },
  { key: "action", label: "Action" },
  { key: "actorEmail", label: "Actor" },
  { key: "actorRole", label: "Actor role" },
  { key: "targetType", label: "Target type" },
  { key: "ip", label: "IP" },
  { key: "reason", label: "Reason" },
];

// ============================ K. Alerts ============================

export async function securityAlerts() {
  const alerts: {
    key: string;
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
    count: number;
    link: string;
  }[] = [];

  const owners = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u WHERE ${PLATFORM_PRED} AND u.platform_role = 'owner' AND NOT u.totp_enabled`
  );
  if (Number(owners.rows[0].n) > 0)
    alerts.push({
      key: "owner_without_2fa",
      severity: "critical",
      title: "Owner without 2FA",
      detail: "An owner account has no two-factor authentication enabled.",
      count: Number(owners.rows[0].n),
      link: "/super-admin/security/two-factor",
    });

  const nonCompliant = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u
     LEFT JOIN security_2fa_policy p ON p.role_key = u.platform_role
     LEFT JOIN platform_security_config c ON c.id = TRUE
     WHERE ${PLATFORM_PRED} AND NOT u.totp_enabled
       AND (COALESCE(p.require_2fa,false) OR COALESCE(c.force_2fa_for_platform,false))
       AND (p.grace_until IS NULL OR p.grace_until < current_date)
       AND u.platform_role <> 'owner'`
  );
  if (Number(nonCompliant.rows[0].n) > 0)
    alerts.push({
      key: "admins_2fa_non_compliant",
      severity: "warning",
      title: "Platform admins non-compliant with 2FA policy",
      detail: "Users whose role requires 2FA have not enabled it (grace elapsed).",
      count: Number(nonCompliant.rows[0].n),
      link: "/super-admin/security/two-factor",
    });

  const failed = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log
     WHERE action='auth.login.failed' AND created_at >= now() - interval '24 hours'`
  );
  if (Number(failed.rows[0].n) >= 10)
    alerts.push({
      key: "failed_logins_spike",
      severity: "warning",
      title: "Elevated failed logins",
      detail: "More than 10 failed sign-in attempts in the last 24 hours.",
      count: Number(failed.rows[0].n),
      link: "/super-admin/security/login-history",
    });

  const locked = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u WHERE ${PLATFORM_PRED} AND u.locked_until IS NOT NULL AND u.locked_until > now()`
  );
  if (Number(locked.rows[0].n) > 0)
    alerts.push({
      key: "locked_accounts",
      severity: "warning",
      title: "Locked platform accounts",
      detail: "One or more platform admin accounts are currently locked.",
      count: Number(locked.rows[0].n),
      link: "/super-admin/security/locked-accounts",
    });

  const longSupport = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_impersonation_sessions
     WHERE ended_at IS NULL AND created_at < now() - interval '2 hours'`
  );
  if (Number(longSupport.rows[0].n) > 0)
    alerts.push({
      key: "long_support_session",
      severity: "warning",
      title: "Long-running support session",
      detail: "A support/impersonation session has been open longer than 2 hours.",
      count: Number(longSupport.rows[0].n),
      link: "/super-admin/platform/support",
    });

  const restores = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log
     WHERE action LIKE 'restore.%' AND created_at >= now() - interval '7 days'`
  );
  if (Number(restores.rows[0].n) > 0)
    alerts.push({
      key: "recent_restore",
      severity: "warning",
      title: "Recent backup restore activity",
      detail: "A backup restore was requested or executed in the last 7 days.",
      count: Number(restores.rows[0].n),
      link: "/super-admin/security/high-risk",
    });

  const gateway = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log
     WHERE action='payment_gateway.settings_changed' AND created_at >= now() - interval '7 days'`
  );
  if (Number(gateway.rows[0].n) > 0)
    alerts.push({
      key: "gateway_changed",
      severity: "info",
      title: "Payment gateway settings changed",
      detail: "Payment gateway settings were changed in the last 7 days.",
      count: Number(gateway.rows[0].n),
      link: "/super-admin/security/high-risk",
    });

  const exports = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_audit_log
     WHERE (action LIKE '%_exported' OR action LIKE '%.exported') AND created_at >= now() - interval '7 days'`
  );
  if (Number(exports.rows[0].n) > 0)
    alerts.push({
      key: "recent_exports",
      severity: "info",
      title: "Recent data/audit exports",
      detail: "Audit or data exports were performed in the last 7 days.",
      count: Number(exports.rows[0].n),
      link: "/super-admin/security/high-risk",
    });

  const expiring = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform_api_tokens
     WHERE revoked_at IS NULL AND expires_at IS NOT NULL
       AND expires_at > now() AND expires_at < now() + interval '7 days'`
  );
  if (Number(expiring.rows[0].n) > 0)
    alerts.push({
      key: "tokens_expiring",
      severity: "info",
      title: "API tokens nearing expiry",
      detail: "One or more platform API tokens expire within 7 days.",
      count: Number(expiring.rows[0].n),
      link: "/super-admin/security/api-tokens",
    });

  return alerts;
}

// ============================ J. Compliance reports ============================

interface ReportResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

/** The subset of a report query buildReport actually reads (report + window). */
type ReportInput = {
  report: ComplianceQuery["report"];
  window?: string;
  dateFrom?: string;
  dateTo?: string;
  role?: string;
  status?: string;
};

/** Post-filter report rows by role/status (uniform across every report shape). */
function applyReportFilters(rows: Record<string, unknown>[], q: ReportInput) {
  let out = rows;
  if (q.role) out = out.filter((r) => r.platformRole === q.role || r.roleKey === q.role);
  if (q.status) out = out.filter((r) => r.status === q.status || r.state === q.status);
  return out;
}

async function buildReport(q: ReportInput): Promise<ReportResult> {
  const params: unknown[] = [];
  const w = windowClause("created_at", q, params);

  switch (q.report) {
    case "platform_admin_access": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT u.full_name AS "fullName", u.email, u.platform_role AS "platformRole",
                CASE WHEN NOT u.is_active THEN 'disabled'
                     WHEN u.locked_until IS NOT NULL AND u.locked_until > now() THEN 'locked'
                     ELSE 'active' END AS status,
                CASE WHEN u.totp_enabled THEN 'yes' ELSE 'no' END AS "twoFactor",
                to_char(u.last_login_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastLoginAt"
         FROM users u WHERE ${PLATFORM_PRED} ORDER BY u.full_name`
      );
      return {
        columns: [
          { key: "fullName", label: "Name" },
          { key: "email", label: "Email" },
          { key: "platformRole", label: "Role" },
          { key: "status", label: "Status" },
          { key: "twoFactor", label: "2FA" },
          { key: "lastLoginAt", label: "Last login" },
        ],
        rows,
      };
    }
    case "rbac_permissions": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT r.name AS "roleName", r.key AS "roleKey", r.kind, p.key AS "permissionKey",
                (SELECT count(*)::int FROM users u WHERE ${PLATFORM_PRED} AND u.platform_role = r.key) AS "usersInRole"
         FROM rbac_roles r
         LEFT JOIN role_permissions rp ON rp.role = r.key
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.status <> 'archived'
         ORDER BY r.is_owner DESC, r.name, p.key`
      );
      return {
        columns: [
          { key: "roleName", label: "Role" },
          { key: "roleKey", label: "Role key" },
          { key: "kind", label: "Type" },
          { key: "permissionKey", label: "Permission" },
          { key: "usersInRole", label: "Users in role" },
        ],
        rows,
      };
    }
    case "twofa_compliance": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT u.full_name AS "fullName", u.email, u.platform_role AS "platformRole",
                CASE WHEN u.totp_enabled THEN 'yes' ELSE 'no' END AS "twoFactor",
                CASE
                  WHEN u.totp_enabled THEN 'compliant'
                  WHEN NOT (COALESCE(p.require_2fa,false) OR COALESCE(c.force_2fa_for_platform,false)) THEN 'exempt'
                  WHEN p.grace_until IS NOT NULL AND p.grace_until >= current_date THEN 'grace'
                  ELSE 'non_compliant' END AS state
         FROM users u
         LEFT JOIN security_2fa_policy p ON p.role_key = u.platform_role
         LEFT JOIN platform_security_config c ON c.id = TRUE
         WHERE ${PLATFORM_PRED} ORDER BY state, u.full_name`
      );
      return {
        columns: [
          { key: "fullName", label: "Name" },
          { key: "email", label: "Email" },
          { key: "platformRole", label: "Role" },
          { key: "twoFactor", label: "2FA enabled" },
          { key: "state", label: "Compliance" },
        ],
        rows,
      };
    }
    case "login_security": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT COALESCE(actor_email, '(unknown)') AS "email",
                count(*) FILTER (WHERE action='auth.login.success')::int AS "successes",
                count(*) FILTER (WHERE action='auth.login.failed')::int AS "failures",
                count(DISTINCT ip)::int AS "distinctIps",
                to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastAt"
         FROM platform_audit_log WHERE action LIKE 'auth.login.%' AND ${w}
         GROUP BY 1 ORDER BY "failures" DESC, "successes" DESC LIMIT 1000`,
        params
      );
      return {
        columns: [
          { key: "email", label: "Email" },
          { key: "successes", label: "Successful" },
          { key: "failures", label: "Failed" },
          { key: "distinctIps", label: "Distinct IPs" },
          { key: "lastAt", label: "Last attempt" },
        ],
        rows,
      };
    }
    case "support_access": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT a.email AS "operator", s.target_email AS "target", s.reason,
                to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startedAt",
                to_char(s.ended_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "endedAt",
                CASE WHEN s.ended_at IS NULL AND s.expires_at > now() THEN 'active' ELSE 'ended' END AS status
         FROM platform_impersonation_sessions s
         LEFT JOIN users a ON a.id = s.actor_id
         WHERE ${w} ORDER BY s.created_at DESC LIMIT 2000`,
        params
      );
      return {
        columns: [
          { key: "operator", label: "Operator" },
          { key: "target", label: "Target user" },
          { key: "reason", label: "Reason" },
          { key: "startedAt", label: "Started" },
          { key: "endedAt", label: "Ended" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    }
    case "audit_activity": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                action, actor_email AS "actor", actor_role AS "actorRole",
                target_type AS "targetType", ip
         FROM platform_audit_log WHERE ${HIGH_RISK_SQL} AND ${w}
         ORDER BY created_at DESC LIMIT 5000`,
        params
      );
      return {
        columns: [
          { key: "createdAt", label: "Time" },
          { key: "action", label: "Action" },
          { key: "actor", label: "Actor" },
          { key: "actorRole", label: "Role" },
          { key: "targetType", label: "Target" },
          { key: "ip", label: "IP" },
        ],
        rows,
      };
    }
    case "sessions": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT u.email, u.platform_role AS "platformRole", rt.ip,
                rt.user_agent AS "userAgent",
                to_char(rt.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                to_char(rt.last_used_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastUsedAt",
                CASE WHEN rt.revoked_at IS NOT NULL THEN 'revoked'
                     WHEN rt.expires_at <= now() THEN 'expired' ELSE 'active' END AS status
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
         WHERE ${PLATFORM_PRED} ORDER BY rt.last_used_at DESC LIMIT 2000`
      );
      return {
        columns: [
          { key: "email", label: "User" },
          { key: "platformRole", label: "Role" },
          { key: "ip", label: "IP" },
          { key: "userAgent", label: "Device" },
          { key: "createdAt", label: "Signed in" },
          { key: "lastUsedAt", label: "Last used" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    }
    case "data_export": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                action, actor_email AS "actor", actor_role AS "actorRole", ip
         FROM platform_audit_log
         WHERE (action LIKE '%_exported' OR action LIKE '%.exported') AND ${w}
         ORDER BY created_at DESC LIMIT 5000`,
        params
      );
      return {
        columns: [
          { key: "createdAt", label: "Time" },
          { key: "action", label: "Export" },
          { key: "actor", label: "Actor" },
          { key: "actorRole", label: "Role" },
          { key: "ip", label: "IP" },
        ],
        rows,
      };
    }
    case "backup_restore": {
      const { rows } = await query<Record<string, unknown>>(
        `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                action, actor_email AS "actor", detail->>'reason' AS "reason", ip
         FROM platform_audit_log
         WHERE (action LIKE 'backup.%' OR action LIKE 'restore.%') AND ${w}
         ORDER BY created_at DESC LIMIT 5000`,
        params
      );
      return {
        columns: [
          { key: "createdAt", label: "Time" },
          { key: "action", label: "Action" },
          { key: "actor", label: "Actor" },
          { key: "reason", label: "Reason" },
          { key: "ip", label: "IP" },
        ],
        rows,
      };
    }
    default:
      throw ApiError.badRequest("Unknown report");
  }
}

export async function complianceReport(q: ComplianceQuery) {
  const { columns, rows } = await buildReport(q);
  const filtered = applyReportFilters(rows, q);
  const start = (q.page - 1) * q.pageSize;
  const paged = filtered.slice(start, start + q.pageSize);
  return { report: q.report, columns, rows: paged, total: filtered.length, page: q.page, pageSize: q.pageSize };
}

export async function complianceReportExport(q: ReportInput) {
  const { columns, rows } = await buildReport(q);
  return { columns, rows: applyReportFilters(rows, q) };
}
