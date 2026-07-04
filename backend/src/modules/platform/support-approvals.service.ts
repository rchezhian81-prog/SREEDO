import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { type Actor, recordAudit } from "./platform.service";
import { maskFreeText, maskSecrets } from "./audit.service";
import type {
  approvalCreateSchema,
  approvalDecisionSchema,
  approvalListQuerySchema,
} from "./support.schema";

/**
 * Super Admin G — Support Access approval workflow (Phase 2, L).
 *
 * A would-be high-risk (write-enabled) support session must be pre-approved.
 * requestApproval creates an append-only pending record; decideApproval settles
 * it (approve/reject, reason required); startSupportSession (support.service)
 * then REQUIRES a matching approved, unconsumed row for a write-enabled start and
 * marks it consumed. Every transition is audited. Nothing here is hard-deleted.
 */

type ApprovalCreate = z.infer<typeof approvalCreateSchema>;
type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

/** Plain projection (single row). */
const APPROVAL_COLS = `
  id,
  requested_by        AS "requestedBy",
  target_id           AS "targetId",
  institution_id      AS "institutionId",
  reason,
  reason_template     AS "reasonTemplate",
  scope,
  allowed_modules     AS "allowedModules",
  expiry_minutes      AS "expiryMinutes",
  risk_reason         AS "riskReason",
  status,
  decided_by          AS "decidedBy",
  decided_at          AS "decidedAt",
  decision_reason     AS "decisionReason",
  consumed_at         AS "consumedAt",
  consumed_session_id AS "consumedSessionId",
  created_at          AS "createdAt"`;

/** Joined projection (list) — resolves requester / target / decider / tenant display. */
const APPROVAL_LIST_COLS = `
  ar.id,
  ar.requested_by        AS "requestedBy",
  rq.email               AS "requestedByEmail",
  ar.target_id           AS "targetId",
  tg.email               AS "targetEmail",
  ar.institution_id      AS "institutionId",
  inst.name              AS "institutionName",
  inst.code              AS "institutionCode",
  ar.reason,
  ar.reason_template     AS "reasonTemplate",
  ar.scope,
  ar.allowed_modules     AS "allowedModules",
  ar.expiry_minutes      AS "expiryMinutes",
  ar.risk_reason         AS "riskReason",
  ar.status,
  ar.decided_by          AS "decidedBy",
  dd.email               AS "decidedByEmail",
  ar.decided_at          AS "decidedAt",
  ar.decision_reason     AS "decisionReason",
  ar.consumed_at         AS "consumedAt",
  ar.consumed_session_id AS "consumedSessionId",
  ar.created_at          AS "createdAt"`;

const APPROVAL_JOINS = `
  FROM support_approval_requests ar
  LEFT JOIN users rq ON rq.id = ar.requested_by
  LEFT JOIN users tg ON tg.id = ar.target_id
  LEFT JOIN users dd ON dd.id = ar.decided_by
  LEFT JOIN institutions inst ON inst.id = ar.institution_id`;

/** Mask any secret-named/looking field and the free-text reasons before returning. */
function maskApprovalRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = maskSecrets(row) as Record<string, unknown>;
  for (const k of ["reason", "riskReason", "decisionReason"]) {
    if (typeof out[k] === "string") out[k] = maskFreeText(out[k]);
  }
  return out;
}

/** Request approval for a would-be high-risk session (records a pending row). */
export async function requestApproval(input: ApprovalCreate, actor: Actor) {
  const target = (
    await query<{ id: string; institutionId: string | null; role: string }>(
      `SELECT id, institution_id AS "institutionId", role FROM users WHERE id = $1`,
      [input.userId]
    )
  ).rows[0];
  if (!target) throw ApiError.notFound("User not found");
  if (target.role === "super_admin") {
    throw ApiError.badRequest("Cannot request support access for a platform super admin");
  }
  const modules = input.scope === "module_limited" ? input.modules ?? [] : [];

  const row = (
    await query<Record<string, unknown>>(
      `INSERT INTO support_approval_requests
         (requested_by, target_id, institution_id, reason, reason_template, scope,
          allowed_modules, expiry_minutes, risk_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       RETURNING ${APPROVAL_COLS}`,
      [
        actor.id,
        target.id,
        target.institutionId,
        input.reason,
        input.reasonTemplate ?? null,
        input.scope,
        modules,
        input.expiryMinutes,
        input.riskReason,
      ]
    )
  ).rows[0];

  await recordAudit(actor, {
    action: "support.approval_requested",
    targetType: "user",
    targetId: target.id,
    institutionId: target.institutionId,
    detail: {
      approvalId: row.id,
      scope: input.scope,
      allowedModules: modules,
      expiryMinutes: input.expiryMinutes,
      reasonTemplate: input.reasonTemplate ?? null,
      riskReason: input.riskReason,
    },
  });
  return maskApprovalRow(row);
}

/** List approval requests (optional status filter; newest first; paginated). */
export async function listApprovals(q: ApprovalListQuery) {
  const params: unknown[] = [];
  let whereSql = "";
  if (q.status) {
    params.push(q.status);
    whereSql = `WHERE ar.status = $${params.length}`;
  }
  const total = (
    await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM support_approval_requests ar ${whereSql}`,
      params
    )
  ).rows[0].n;
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${APPROVAL_LIST_COLS} ${APPROVAL_JOINS} ${whereSql}
     ORDER BY ar.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(maskApprovalRow), total, page: q.page, pageSize: q.pageSize };
}

/** Approve or reject a pending request (reason required; audited; idempotent-safe). */
export async function decideApproval(id: string, input: ApprovalDecision, actor: Actor) {
  const existing = (
    await query<{ status: string; target_id: string; institution_id: string | null }>(
      `SELECT status, target_id, institution_id FROM support_approval_requests WHERE id = $1`,
      [id]
    )
  ).rows[0];
  if (!existing) throw ApiError.notFound("Approval request not found");
  if (existing.status !== "pending") {
    throw ApiError.badRequest("This approval request has already been decided");
  }

  const row = (
    await query<Record<string, unknown>>(
      `UPDATE support_approval_requests
         SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4
       WHERE id = $1 AND status = 'pending'
       RETURNING ${APPROVAL_COLS}`,
      [id, input.decision, actor.id, input.reason]
    )
  ).rows[0];
  if (!row) throw ApiError.conflict("This approval request has already been decided");

  await recordAudit(actor, {
    action: input.decision === "approved" ? "support.approval_approved" : "support.approval_rejected",
    targetType: "user",
    targetId: existing.target_id,
    institutionId: existing.institution_id,
    detail: { approvalId: id, decision: input.decision, decisionReason: input.reason },
  });
  return maskApprovalRow(row);
}
