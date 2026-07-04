import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { signAccessToken } from "../../utils/jwt";
import { recordSecurityEvent } from "../../utils/security-audit";
import type { UserRole } from "../../types";
import { type Actor, recordAudit } from "./platform.service";
// Reuse the Audit Console's (Super Admin F) secret masker — one source of truth.
import { maskSecrets } from "./audit.service";
import {
  REASON_TEMPLATES,
  SUPPORT_MODULES,
  SUPPORT_SCOPES,
  type listQuerySchema,
  type startSchema,
  type summaryQuerySchema,
} from "./support.schema";

/** Request-scoped metadata captured on session start (audit + forensics). */
export interface ReqMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Static reference data for the UI dropdowns. */
export function templates() {
  return {
    templates: [...REASON_TEMPLATES],
    modules: [...SUPPORT_MODULES],
    scopes: [...SUPPORT_SCOPES],
  };
}

// Shared projection: one support session with operator/target/tenant display and
// a computed live/settled duration in minutes.
const SESSION_COLS = `
  s.id,
  s.actor_id            AS "operatorId",
  op.email              AS "operatorEmail",
  op.full_name          AS "operatorName",
  s.target_id           AS "targetId",
  s.target_email        AS "targetEmail",
  s.target_role         AS "targetRole",
  s.institution_id      AS "institutionId",
  inst.name             AS "institutionName",
  inst.code             AS "institutionCode",
  s.scope,
  s.allowed_modules     AS "allowedModules",
  s.status,
  s.reason,
  s.reason_template     AS "reasonTemplate",
  s.ip,
  s.user_agent          AS "userAgent",
  s.created_at          AS "startedAt",
  s.expires_at          AS "expiresAt",
  s.ended_at            AS "endedAt",
  s.ended_by            AS "endedBy",
  s.revoked_by          AS "revokedBy",
  s.revoke_reason       AS "revokeReason",
  ROUND(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.created_at)) / 60.0)::int AS "durationMinutes"`;

const SESSION_JOINS = `
  FROM platform_impersonation_sessions s
  LEFT JOIN users op ON op.id = s.actor_id
  LEFT JOIN institutions inst ON inst.id = s.institution_id`;

interface TargetRow {
  id: string;
  email: string;
  role: string;
  institutionId: string | null;
  fullName: string;
}

/**
 * Start a governed, scope-enforced support session AS the target tenant user.
 * The issued token carries an `imp` claim so `enforceSupportScope` can gate every
 * subsequent request; the DB row is the authoritative, revocable source of truth.
 * Never returns any secret. `opts.auditAction` lets the legacy /impersonate path
 * keep emitting `impersonate.start` while still going through this governed path.
 */
export async function startSupportSession(
  input: z.infer<typeof startSchema>,
  actor: Actor,
  reqMeta: ReqMeta,
  opts?: { auditAction?: string }
) {
  const target = (
    await query<TargetRow>(
      `SELECT id, email, role, institution_id AS "institutionId", full_name AS "fullName"
       FROM users WHERE id = $1`,
      [input.userId]
    )
  ).rows[0];
  if (!target) throw ApiError.notFound("User not found");
  if (target.role === "super_admin") {
    throw ApiError.badRequest("Cannot impersonate a platform super admin");
  }
  if (!target.institutionId) {
    throw ApiError.badRequest("Target is not a tenant user");
  }

  // One active session per operator (server-side invariant, not just UI).
  const active = await query(
    `SELECT 1 FROM platform_impersonation_sessions
     WHERE actor_id = $1 AND status = 'active' AND expires_at > now() LIMIT 1`,
    [actor.id]
  );
  if (active.rows[0]) {
    throw ApiError.conflict(
      "You already have an active support session. End it before starting another."
    );
  }

  const scope = input.scope;
  const modules = scope === "module_limited" ? input.modules ?? [] : [];
  const now = Date.now();
  const expiresAt = new Date(now + input.expiryMinutes * 60_000);

  const session = (
    await query<{ id: string }>(
      `INSERT INTO platform_impersonation_sessions
         (actor_id, target_id, target_email, reason, expires_at, status, scope,
          allowed_modules, institution_id, target_role, reason_template, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        actor.id,
        target.id,
        target.email,
        input.reason,
        expiresAt.toISOString(),
        scope,
        modules,
        target.institutionId,
        target.role,
        input.reasonTemplate ?? null,
        reqMeta.ip,
        reqMeta.userAgent,
      ]
    )
  ).rows[0];

  const token = signAccessToken(
    {
      sub: target.id,
      email: target.email,
      role: target.role as UserRole,
      institutionId: target.institutionId,
      imp: {
        sid: session.id,
        actorId: actor.id,
        scope,
        modules: scope === "module_limited" ? modules : undefined,
      },
    },
    { expiresIn: `${input.expiryMinutes}m` }
  );

  await recordAudit(actor, {
    action: opts?.auditAction ?? "support.session_started",
    targetType: "user",
    targetId: target.id,
    institutionId: target.institutionId,
    detail: {
      targetEmail: target.email,
      targetRole: target.role,
      reason: input.reason,
      reasonTemplate: input.reasonTemplate ?? null,
      scope,
      allowedModules: modules,
      expiryMinutes: input.expiryMinutes,
      expiresAt: expiresAt.toISOString(),
    },
  });

  // NEVER return the password hash / refresh token / any stored secret.
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    session: {
      id: session.id,
      scope,
      allowedModules: modules,
      status: "active",
      expiresAt: expiresAt.toISOString(),
    },
    user: {
      id: target.id,
      email: target.email,
      role: target.role,
      institutionId: target.institutionId,
      fullName: target.fullName,
    },
  };
}

/**
 * End an active session — the operator's own (by actorId) or a specific one (by
 * sessionId). Idempotent (ends 0 if none active). `opts.auditAction` lets the
 * legacy /impersonate/end path keep emitting `impersonate.end`.
 */
export async function endSupportSession(
  target: { actorId?: string; sessionId?: string },
  actor: Actor,
  opts?: { auditAction?: string }
) {
  const where: string[] = ["status = 'active'"];
  const params: unknown[] = [];
  if (target.sessionId) {
    params.push(target.sessionId);
    where.push(`id = $${params.length}`);
  } else if (target.actorId) {
    params.push(target.actorId);
    where.push(`actor_id = $${params.length}`);
  } else {
    throw ApiError.badRequest("actorId or sessionId is required to end a session");
  }
  params.push(actor.id);
  const rows = (
    await query<{
      id: string;
      target_id: string;
      target_email: string;
      institution_id: string | null;
    }>(
      `UPDATE platform_impersonation_sessions
         SET status = 'ended', ended_at = now(), ended_by = $${params.length}
       WHERE ${where.join(" AND ")}
       RETURNING id, target_id, target_email, institution_id`,
      params
    )
  ).rows;

  for (const r of rows) {
    await recordAudit(actor, {
      action: opts?.auditAction ?? "support.session_ended",
      targetType: "user",
      targetId: r.target_id,
      institutionId: r.institution_id,
      detail: { sessionId: r.id, targetEmail: r.target_email },
    });
  }
  return { ended: rows.length };
}

/** Force-revoke one session (reason required). 404 if missing; safe if already ended. */
export async function revokeSession(sessionId: string, reason: string, actor: Actor) {
  const existing = (
    await query<{ status: string }>(
      `SELECT status FROM platform_impersonation_sessions WHERE id = $1`,
      [sessionId]
    )
  ).rows[0];
  if (!existing) throw ApiError.notFound("Support session not found");

  const rows = (
    await query<{
      id: string;
      target_id: string;
      target_email: string;
      institution_id: string | null;
      actor_id: string;
    }>(
      `UPDATE platform_impersonation_sessions
         SET status = 'revoked', ended_at = now(), revoked_by = $2, revoke_reason = $3
       WHERE id = $1 AND status = 'active'
       RETURNING id, target_id, target_email, institution_id, actor_id`,
      [sessionId, actor.id, reason]
    )
  ).rows;

  const r = rows[0];
  if (r) {
    await recordAudit(actor, {
      action: "support.session_revoked",
      targetType: "user",
      targetId: r.target_id,
      institutionId: r.institution_id,
      detail: {
        sessionId,
        revokeReason: reason,
        targetEmail: r.target_email,
        operatorId: r.actor_id,
      },
    });
  }
  return { revoked: rows.length, alreadyInactive: rows.length === 0 };
}

/** Bulk-revoke every active session for one operator (audited per revoked row). */
export async function revokeByOperator(operatorId: string, reason: string, actor: Actor) {
  const rows = (
    await query<{
      id: string;
      target_id: string;
      target_email: string;
      institution_id: string | null;
    }>(
      `UPDATE platform_impersonation_sessions
         SET status = 'revoked', ended_at = now(), revoked_by = $2, revoke_reason = $3
       WHERE actor_id = $1 AND status = 'active'
       RETURNING id, target_id, target_email, institution_id`,
      [operatorId, actor.id, reason]
    )
  ).rows;
  for (const r of rows) {
    await recordAudit(actor, {
      action: "support.session_revoked",
      targetType: "user",
      targetId: r.target_id,
      institutionId: r.institution_id,
      detail: { sessionId: r.id, revokeReason: reason, scope: "operator", operatorId },
    });
  }
  return { revoked: rows.length };
}

/** Bulk-revoke every active session touching one tenant (audited per revoked row). */
export async function revokeByTenant(institutionId: string, reason: string, actor: Actor) {
  const rows = (
    await query<{
      id: string;
      target_id: string;
      target_email: string;
      institution_id: string | null;
    }>(
      `UPDATE platform_impersonation_sessions
         SET status = 'revoked', ended_at = now(), revoked_by = $2, revoke_reason = $3
       WHERE institution_id = $1 AND status = 'active'
       RETURNING id, target_id, target_email, institution_id`,
      [institutionId, actor.id, reason]
    )
  ).rows;
  for (const r of rows) {
    await recordAudit(actor, {
      action: "support.session_revoked",
      targetType: "user",
      targetId: r.target_id,
      institutionId: r.institution_id,
      detail: { sessionId: r.id, revokeReason: reason, scope: "tenant", tenantId: institutionId },
    });
  }
  return { revoked: rows.length };
}

/**
 * Transition any active-but-expired sessions to 'expired'. Called at the top of
 * the read paths so state + history stay consistent without a background job.
 * Best-effort audit per swept row (never blocks the read).
 */
export async function sweepExpired(): Promise<number> {
  const rows = (
    await query<{
      id: string;
      actor_id: string;
      target_id: string;
      institution_id: string | null;
    }>(
      `UPDATE platform_impersonation_sessions
         SET status = 'expired', ended_at = expires_at
       WHERE status = 'active' AND expires_at <= now()
       RETURNING id, actor_id, target_id, institution_id`
    )
  ).rows;
  for (const r of rows) {
    await recordSecurityEvent({
      action: "support.session_expired",
      actorId: r.actor_id,
      actorRole: "super_admin",
      targetType: "user",
      targetId: r.target_id,
      institutionId: r.institution_id,
      detail: { sessionId: r.id },
      ip: null,
    });
  }
  return rows.length;
}

/** Currently-live sessions (post-sweep), newest first. */
export async function listActive() {
  await sweepExpired();
  const { rows } = await query(
    `SELECT ${SESSION_COLS} ${SESSION_JOINS}
     WHERE s.status = 'active' AND s.expires_at > now()
     ORDER BY s.created_at DESC`
  );
  return rows;
}

const LIST_SORT: Record<string, string> = {
  createdAt: "s.created_at",
  status: "s.status",
  scope: "s.scope",
};

/** Session history with filters, pagination and sort (post-sweep, computed duration). */
export async function listSessions(q: z.infer<typeof listQuerySchema>) {
  await sweepExpired();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.dateFrom) add((n) => `s.created_at >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `s.created_at <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  if (q.institutionId) add((n) => `s.institution_id = $${n}`, q.institutionId);
  if (q.targetId) add((n) => `s.target_id = $${n}`, q.targetId);
  if (q.operatorId) add((n) => `s.actor_id = $${n}`, q.operatorId);
  if (q.status) add((n) => `s.status = $${n}`, q.status);
  if (q.scope) add((n) => `s.scope = $${n}`, q.scope);
  if (q.reasonTemplate) add((n) => `s.reason_template = $${n}`, q.reasonTemplate);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const count = (
    await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_impersonation_sessions s ${whereSql}`,
      params
    )
  ).rows[0].n;

  const sortCol = LIST_SORT[q.sort] ?? "s.created_at";
  const dir = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${SESSION_COLS} ${SESSION_JOINS}
     ${whereSql}
     ORDER BY ${sortCol} ${dir} NULLS LAST, s.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count, page: q.page, pageSize: q.pageSize };
}

/** Full detail for one session (secret-masked; ended_by/revoked_by emails resolved). */
export async function getSession(id: string) {
  const { rows } = await query(
    `SELECT ${SESSION_COLS},
            eb.email AS "endedByEmail",
            rb.email AS "revokedByEmail"
     ${SESSION_JOINS}
     LEFT JOIN users eb ON eb.id = s.ended_by
     LEFT JOIN users rb ON rb.id = s.revoked_by
     WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Support session not found");
  return maskSecrets(rows[0]) as Record<string, unknown>;
}

/** Resolve the summary window to an inclusive lower bound (SQL timestamptz literal). */
function windowStart(q: z.infer<typeof summaryQuerySchema>): string | null {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  switch (q.window) {
    case "today":
      return new Date(new Date().toISOString().slice(0, 10)).toISOString();
    case "7d":
      return new Date(now - 7 * day).toISOString();
    case "30d":
      return new Date(now - 30 * day).toISOString();
    case "custom":
      return q.dateFrom ? `${q.dateFrom}T00:00:00.000Z` : null;
  }
}

/** Dashboard summary cards for the Support Access console. */
export async function summary(q: z.infer<typeof summaryQuerySchema>) {
  await sweepExpired();
  const from = windowStart(q);

  const counters = (
    await query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE status = 'active' AND expires_at > now())::int AS "activeCount",
         count(*) FILTER (WHERE created_at::date = current_date)::int          AS "startedToday",
         count(*) FILTER (WHERE status = 'ended'   AND ended_at::date = current_date)::int AS "endedToday",
         count(*) FILTER (WHERE status = 'expired' AND ended_at::date = current_date)::int AS "expiredToday",
         count(*) FILTER (WHERE status = 'revoked' AND ended_at::date = current_date)::int AS "revokedToday",
         count(*) FILTER (WHERE status = 'active' AND (
                 scope IN ('write_enabled','module_limited')
              OR now() - created_at > interval '60 minutes'))::int AS "highRiskCount",
         COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - created_at)) / 60.0)
                  FILTER (WHERE ended_at IS NOT NULL))::numeric, 0)::float AS "avgDurationMinutes"
       FROM platform_impersonation_sessions`
    )
  ).rows[0];

  const byOperator = (
    await query(
      `SELECT s.actor_id AS "operatorId", op.email AS "operatorEmail", count(*)::int AS "sessions"
       FROM platform_impersonation_sessions s
       LEFT JOIN users op ON op.id = s.actor_id
       ${from ? "WHERE s.created_at >= $1" : ""}
       GROUP BY s.actor_id, op.email
       ORDER BY count(*) DESC LIMIT 20`,
      from ? [from] : []
    )
  ).rows;

  const byTenant = (
    await query(
      `SELECT s.institution_id AS "institutionId", inst.name AS "institutionName",
              inst.code AS "institutionCode", count(*)::int AS "sessions"
       FROM platform_impersonation_sessions s
       LEFT JOIN institutions inst ON inst.id = s.institution_id
       ${from ? "WHERE s.created_at >= $1" : ""}
       GROUP BY s.institution_id, inst.name, inst.code
       ORDER BY count(*) DESC LIMIT 20`,
      from ? [from] : []
    )
  ).rows;

  const nearingExpiry = (
    await query(
      `SELECT ${SESSION_COLS} ${SESSION_JOINS}
       WHERE s.status = 'active' AND s.expires_at > now()
         AND s.expires_at <= now() + interval '5 minutes'
       ORDER BY s.expires_at ASC`
    )
  ).rows;

  const recentAuditEvents = (
    await query(
      `SELECT id, action, actor_id AS "actorId", actor_email AS "actorEmail",
              target_id AS "targetId", institution_id AS "institutionId",
              detail, created_at AS "createdAt"
       FROM platform_audit_log
       WHERE action LIKE 'support.%' OR action LIKE 'impersonate.%'
       ORDER BY created_at DESC LIMIT 20`
    )
  ).rows;

  return {
    window: q.window,
    activeCount: Number(counters.activeCount),
    startedToday: Number(counters.startedToday),
    endedToday: Number(counters.endedToday),
    expiredToday: Number(counters.expiredToday),
    revokedToday: Number(counters.revokedToday),
    highRiskCount: Number(counters.highRiskCount),
    avgDurationMinutes: Number(counters.avgDurationMinutes),
    byOperator,
    byTenant,
    nearingExpiry,
    recentAuditEvents,
  };
}

/** Security-Center posture (data only; no side effects beyond the sweep). */
export async function securitySummary() {
  await sweepExpired();
  const counts = (
    await query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE status = 'active' AND expires_at > now())::int AS "activeCount",
         count(*) FILTER (WHERE status = 'active' AND now() - created_at > interval '60 minutes')::int AS "longRunningCount"
       FROM platform_impersonation_sessions`
    )
  ).rows[0];

  const recentlyRevoked = (
    await query(
      `SELECT ${SESSION_COLS} ${SESSION_JOINS}
       WHERE s.status = 'revoked' AND s.ended_at >= now() - interval '24 hours'
       ORDER BY s.ended_at DESC LIMIT 50`
    )
  ).rows;

  const highRisk = (
    await query(
      `SELECT ${SESSION_COLS} ${SESSION_JOINS}
       WHERE s.status = 'active' AND s.expires_at > now()
         AND (s.scope IN ('write_enabled','module_limited')
              OR now() - s.created_at > interval '60 minutes')
       ORDER BY s.created_at ASC LIMIT 50`
    )
  ).rows;

  return {
    activeCount: Number(counts.activeCount),
    longRunningCount: Number(counts.longRunningCount),
    recentlyRevoked,
    highRisk,
  };
}
