import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { maskFreeText } from "../platform/audit.service";
import {
  applyRestoreDump,
  performBackup,
  recordAudit,
  restorePreview,
  type Actor,
} from "./backups.service";
import type {
  restoreCancelSchema,
  restoreDecisionSchema,
  restoreExecuteSchema,
  restoreListQuerySchema,
  restoreRequestSchema,
} from "./backups.schema";

/** A restore request expires this many hours after creation if not executed. */
const EXPIRY_HOURS = 24;

/** Typed final-confirmation phrase the operator must enter to execute a restore. */
export function confirmPhraseFor(backupId: string): string {
  return `RESTORE ${backupId.slice(0, 8)}`;
}

// Projection with backup + requester/decider emails. `status` is surfaced as
// 'expired' once a still-pending request passes its expiry. Free-text is masked.
const SELECT = `
  r.id, r.backup_id AS "backupId", b.scope AS "backupScope", b.created_at AS "backupCreatedAt",
  b.checksum_status AS "backupChecksumStatus",
  r.scope, r.reason, r.risk_reason AS "riskReason", r.impact_preview AS "impactPreview",
  CASE WHEN r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at < now()
       THEN 'expired' ELSE r.status END AS "status",
  r.requested_by AS "requestedBy", ru.email AS "requestedByEmail",
  r.decided_by AS "decidedBy", du.email AS "decidedByEmail",
  r.decided_at AS "decidedAt", r.decision_reason AS "decisionReason",
  r.consumed_at AS "consumedAt", r.executed_at AS "executedAt",
  r.executed_by AS "executedBy", eu.email AS "executedByEmail",
  r.execution_result AS "executionResult", r.execution_detail AS "executionDetail",
  r.pre_restore_backup_id AS "preRestoreBackupId",
  r.expires_at AS "expiresAt", r.created_at AS "createdAt"`;

const JOINS = `
  FROM restore_requests r
  JOIN backups b ON b.id = r.backup_id
  LEFT JOIN users ru ON ru.id = r.requested_by
  LEFT JOIN users du ON du.id = r.decided_by
  LEFT JOIN users eu ON eu.id = r.executed_by`;

/** Mask operator-typed free-text (a pasted secret must never persist/echo). */
function maskRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!row) return row;
  return {
    ...row,
    reason: row.reason ? maskFreeText(String(row.reason)) : row.reason,
    riskReason: row.riskReason ? maskFreeText(String(row.riskReason)) : row.riskReason,
    decisionReason: row.decisionReason ? maskFreeText(String(row.decisionReason)) : row.decisionReason,
    confirmPhrase: confirmPhraseFor(String(row.backupId)),
  };
}

async function loadRow(id: string): Promise<Record<string, unknown>> {
  const { rows } = await query(`SELECT ${SELECT} ${JOINS} WHERE r.id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Restore request not found");
  return rows[0];
}

/**
 * Raise a restore request. Snapshots the read-only impact preview at request time
 * (so approvers see exactly what was proposed) and validates the backup is a
 * restorable global backup. Starts in 'pending'; audited.
 */
export async function requestRestore(
  backupId: string,
  input: z.infer<typeof restoreRequestSchema>,
  actor: Actor
) {
  // restorePreview throws if the backup has no artifact; also captures scope/schema.
  const preview = await restorePreview(backupId);
  if (preview.scope !== "global") {
    throw ApiError.badRequest("Only global backups can be restored");
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO restore_requests
       (backup_id, scope, reason, risk_reason, impact_preview, requested_by, status, expires_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending', now() + ($7 || ' hours')::interval)
     RETURNING id`,
    [backupId, input.scope, input.reason, input.riskReason ?? null, JSON.stringify(preview), actor.id, String(EXPIRY_HOURS)]
  );
  await recordAudit(actor, {
    action: "restore.requested",
    targetId: backupId,
    institutionId: null,
    detail: { requestId: rows[0].id, scope: input.scope, reason: maskFreeText(input.reason) },
  });
  return maskRow(await loadRow(rows[0].id));
}

export async function listRestoreRequests(q: z.infer<typeof restoreListQuerySchema>) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.status) {
    params.push(q.status);
    where.push(
      `(CASE WHEN r.status='pending' AND r.expires_at IS NOT NULL AND r.expires_at < now()
             THEN 'expired' ELSE r.status END) = $${params.length}`
    );
  }
  if (q.backupId) {
    params.push(q.backupId);
    where.push(`r.backup_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM restore_requests r ${whereSql}`, params)).rows[0].n
  );
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query(
    `SELECT ${SELECT} ${JOINS} ${whereSql}
     ORDER BY r.created_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows: rows.map(maskRow), total, page: q.page, pageSize: q.pageSize };
}

export async function getRestoreRequest(id: string) {
  return maskRow(await loadRow(id));
}

/**
 * Approve or reject a pending request. Self-approval is blocked — the approver must
 * be a different user than the requester (two-person integrity). Optimistic lock on
 * status='pending' so a race can't double-decide. Reason required; audited.
 */
export async function decideRestore(
  id: string,
  input: z.infer<typeof restoreDecisionSchema>,
  actor: Actor
) {
  const row = await loadRow(id);
  if (row.status !== "pending") {
    throw ApiError.badRequest(`Request is already ${String(row.status)}`);
  }
  if (input.decision === "approved" && row.requestedBy && row.requestedBy === actor.id) {
    throw ApiError.forbidden(
      "You cannot approve your own restore request — a different super-admin must approve it"
    );
  }
  const { rows } = await query(
    `UPDATE restore_requests
       SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [id, input.decision, actor.id, input.reason]
  );
  if (!rows[0]) throw ApiError.conflict("Request was already decided");
  await recordAudit(actor, {
    action: input.decision === "approved" ? "restore.approved" : "restore.rejected",
    targetId: String(row.backupId),
    institutionId: null,
    detail: { requestId: id, reason: maskFreeText(input.reason) },
  });
  return maskRow(await loadRow(id));
}

/** Cancel a pending/approved request (requester or any super-admin). Reason required. */
export async function cancelRestore(
  id: string,
  input: z.infer<typeof restoreCancelSchema>,
  actor: Actor
) {
  const row = await loadRow(id);
  if (!["pending", "approved"].includes(String(row.status))) {
    throw ApiError.badRequest(`Only a pending or approved request can be cancelled (is ${String(row.status)})`);
  }
  const { rows } = await query(
    `UPDATE restore_requests
       SET status='cancelled', decision_reason = coalesce(decision_reason,'') || $2
     WHERE id = $1 AND status IN ('pending','approved') AND consumed_at IS NULL
     RETURNING id`,
    [id, ` [cancelled: ${input.reason}]`]
  );
  if (!rows[0]) throw ApiError.conflict("Request can no longer be cancelled");
  await recordAudit(actor, {
    action: "restore.cancelled",
    targetId: String(row.backupId),
    institutionId: null,
    detail: { requestId: id, reason: maskFreeText(input.reason) },
  });
  return maskRow(await loadRow(id));
}

/**
 * Execute an APPROVED restore. High-friction + safe:
 *  1) request must be approved, unconsumed and unexpired,
 *  2) the typed confirmation phrase must match,
 *  3) a fresh pre-restore backup is taken FIRST (rollback safety net),
 *  4) the target checksum is re-validated (corrupt ⇒ blocked unless force),
 *  5) the destructive reload runs in one transaction (rolled back on error).
 * The approval is single-use (consumed_at). Production additionally needs force.
 */
export async function executeRestore(
  id: string,
  input: z.infer<typeof restoreExecuteSchema>,
  actor: Actor
) {
  const row = await loadRow(id);
  if (row.status !== "approved") {
    throw ApiError.badRequest(`Only an approved request can be executed (is ${String(row.status)})`);
  }
  if (row.consumedAt) throw ApiError.conflict("This approval has already been used");
  const backupId = String(row.backupId);
  if (input.confirmText.trim() !== confirmPhraseFor(backupId)) {
    throw ApiError.badRequest(`Confirmation phrase must be exactly: ${confirmPhraseFor(backupId)}`);
  }

  // Single-use claim: mark consumed before doing anything destructive.
  const claim = await query(
    `UPDATE restore_requests SET consumed_at = now()
     WHERE id = $1 AND status = 'approved' AND consumed_at IS NULL RETURNING id`,
    [id]
  );
  if (!claim.rows[0]) throw ApiError.conflict("This approval has already been used");

  // (3) Mandatory pre-restore backup — the rollback safety net. If it fails we
  //     abort BEFORE touching data and leave the request consumed+failed.
  let preRestoreBackupId: string | null = null;
  try {
    const pre = (await performBackup({
      scope: "global",
      institutionId: null,
      trigger: "pre_restore",
      actor,
    })) as { id: string };
    preRestoreBackupId = pre.id;
    await query(`UPDATE restore_requests SET pre_restore_backup_id = $2 WHERE id = $1`, [id, pre.id]);
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "pre-restore backup failed").slice(0, 300);
    await query(
      `UPDATE restore_requests SET status='failed', execution_result='failed',
         execution_detail = $2::jsonb, executed_at = now(), executed_by = $3 WHERE id = $1`,
      [id, JSON.stringify({ stage: "pre_restore_backup", error: safe }), actor.id]
    );
    await recordAudit(actor, {
      action: "restore.failed",
      targetId: backupId,
      institutionId: null,
      detail: { requestId: id, stage: "pre_restore_backup", error: safe },
    });
    throw new ApiError(500, `Aborted: pre-restore backup failed (${safe})`);
  }

  // (4)+(5) Execute the destructive restore (checksum re-validated inside).
  try {
    const result = await applyRestoreDump(backupId, actor, { force: input.force, requestId: id });
    await query(
      `UPDATE restore_requests SET status='executed', execution_result='success',
         execution_detail = $2::jsonb, executed_at = now(), executed_by = $3 WHERE id = $1`,
      [id, JSON.stringify({ tableCount: result.tableCount, rowCount: result.rowCount, preRestoreBackupId }), actor.id]
    );
    await recordAudit(actor, {
      action: "restore.executed",
      targetId: backupId,
      institutionId: null,
      detail: { requestId: id, preRestoreBackupId, rowCount: result.rowCount },
    });
    return { executed: true, requestId: id, preRestoreBackupId, ...result };
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "restore failed").slice(0, 300);
    await query(
      `UPDATE restore_requests SET status='failed', execution_result='failed',
         execution_detail = $2::jsonb, executed_at = now(), executed_by = $3 WHERE id = $1`,
      [id, JSON.stringify({ stage: "restore", error: safe, preRestoreBackupId }), actor.id]
    );
    throw err;
  }
}

/**
 * Test / dry-run restore: proves a backup is RESTORABLE without touching live data
 * — decodes the artifact, re-validates the checksum, and checks schema
 * compatibility + row counts. A full sandbox-DB restore is a documented future
 * enhancement; this dry-run is the safe, in-app verification. Audited.
 */
export async function testRestore(backupId: string, actor: Actor) {
  const preview = await restorePreview(backupId);
  const report = {
    backupId,
    decoded: true,
    checksumStatus: preview.checksumStatus,
    schemaMatches: preview.schemaMatches,
    restorable: preview.restorable,
    tableCount: preview.tableCount,
    totalRows: preview.totalRows,
    note:
      "Dry-run only: the artifact decoded and was validated. A full sandbox-database restore into a disposable target is not yet supported in-app — see the Disaster Recovery guide for the manual test-restore procedure.",
  };
  await recordAudit(actor, {
    action: "restore.test",
    targetId: backupId,
    institutionId: null,
    detail: { restorable: report.restorable, schemaMatches: report.schemaMatches, checksumStatus: report.checksumStatus },
  });
  return report;
}
