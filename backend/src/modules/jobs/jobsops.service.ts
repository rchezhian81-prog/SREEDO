import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { maskSecrets, maskFreeText } from "../platform/audit.service";
import { recordSecurityEvent } from "../../utils/security-audit";
import { enqueue, runSchedulerTick } from "./jobs.service";
import {
  processDueJobs,
  moveToDeadLetter,
  requeueFromDeadLetter,
  BACKOFF_BASE_MS,
} from "./jobs.worker";
import { enqueueDueScheduledBackups } from "../backups/backups.service";
import { enqueueDueScheduledExports } from "../exports/exports.service";
import { sweepSubscriptionLifecycle } from "../billing/billing.service";
import {
  evaluateAlertRules,
  ackAlert as lAckAlert,
  resolveAlert as lResolveAlert,
} from "../observability/alerts.service";
import { jobsHealth } from "../observability/opsdashboard.service";
import type {
  summaryQuerySchema,
  listJobsQuerySchema,
  deadLetterQuerySchema,
  bulkSchema,
  scheduleActionSchema,
  alertListQuerySchema,
  reportsQuerySchema,
  exportQuerySchema,
} from "./jobsops.schema";

/**
 * Super Admin M — Background Jobs Console / Queue Governance (service layer).
 *
 * A governed reader + operator over the durable job queue (0040_jobs) and its
 * operations layer (0101_jobs_ops: job_attempts, worker_heartbeats, dead-letter
 * state). EVERYTHING user-visible is masked (payload/result/error/dead-letter
 * reason/export) through the shared `maskSecrets` / `maskFreeText` helpers — no
 * token, cookie, password, API key, SMTP/DB credential, storage key, gateway
 * secret, session or 2FA secret, and no stack trace, ever leaves this service.
 * No job / attempt / heartbeat / alert is ever hard-deleted: status transitions
 * only. Every sensitive action is audited (jobs.* → platform_audit_log) and the
 * high-risk ones (dead-letter / bulk / critical-schedule pause) also raise a
 * security event.
 */

// ============================ Actor + audit ==================================

export interface Actor {
  id: string;
  email: string;
  role: string;
  ip: string | null;
}

interface AuditInput {
  action: string;
  targetType?: string;
  targetId: string | null;
  institutionId?: string | null;
  detail?: Record<string, unknown>;
}

/** Durable, secret-free jobs-console audit entry (module-local; mirrors L's). */
async function recordAudit(actor: Actor, input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO platform_audit_log
       (action, target_type, target_id, institution_id, actor_id, actor_email, actor_role, detail, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      input.action,
      input.targetType ?? "job",
      input.targetId,
      input.institutionId ?? null,
      actor.id,
      actor.email,
      actor.role,
      JSON.stringify(maskSecrets(input.detail ?? {})),
      actor.ip,
    ]
  );
}

// ============================ Constants / mapping ============================

const STUCK_SQL = "j.status='running' AND j.locked_at < now() - interval '10 minutes'";

/** Job type → source module (used for the module filter + module-wise reports). */
export const SOURCE_MODULE: Record<string, string> = {
  scheduled_report_run: "Reports",
  fee_reminder_sweep: "Communication",
  absence_alert_sweep: "Communication",
  scheduled_backup: "Backup",
  scheduled_export: "Export",
  webhook_deliver: "Integrations",
  alert_evaluation: "Observability",
  noop: "System",
};
export function moduleForType(type: string): string {
  return SOURCE_MODULE[type] ?? "Other";
}

/** Job-type set that the scheduler tick enqueues (for scheduler-run reports). */
const SCHEDULED_TYPES = ["scheduled_report_run", "scheduled_backup", "scheduled_export"];

/** L alert types that are job/worker/scheduler-related (the ONE alert store). */
const JOB_ALERT_TYPES = [
  "queue_depth_high",
  "job_failure_spike",
  "worker_down",
  "scheduler_stalled",
  "backup_failed",
  "error_rate_high",
];

/** Read-only "system" schedules that run on every worker tick (no pause). */
const SYSTEM_SCHEDULES = [
  { id: "subscription_lifecycle", name: "Subscription lifecycle sweep", jobType: "subscription_lifecycle_sweep" },
  { id: "alert_evaluation", name: "Health & alert evaluation sweep", jobType: "alert_evaluation" },
];

// Related-entity payload keys surfaced as typed links on the detail view. These
// are opaque references (uuids), never secrets.
const LINK_KEYS: Record<string, string> = {
  institutionId: "institution",
  invoiceId: "invoice",
  subscriptionId: "subscription",
  exportId: "export",
  backupId: "backup",
  reportId: "report",
  scheduleId: "schedule",
  emailId: "email",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================ Masking helpers ================================

/** Deep-mask a payload, then DROP obvious secret-looking top-level keys. Never
 *  returns a token/secret/password/key/authorization value. */
function maskPayload(payload: unknown): Record<string, unknown> {
  const masked = maskSecrets(payload ?? {});
  if (!masked || typeof masked !== "object" || Array.isArray(masked)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(masked as Record<string, unknown>)) {
    if (/token|secret|password|key|authorization|cookie|credential/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

const mtext = (v: unknown): string | null => (v == null ? null : (maskFreeText(v) as string));

// ============================ Job columns / FROM ============================

const JOBS_FROM = "FROM jobs j LEFT JOIN institutions inst ON inst.id = j.institution_id";

const JOB_COLS = `
  j.id, j.type, j.payload, j.status, j.priority, j.attempts, j.max_attempts AS "maxAttempts",
  j.queue, j.run_at AS "runAt", j.locked_at AS "lockedAt", j.locked_by AS "lockedBy",
  j.started_at AS "startedAt", j.completed_at AS "completedAt", j.error,
  j.dead_lettered_at AS "deadLetteredAt", j.dead_letter_reason AS "deadLetterReason",
  j.dedupe_key AS "dedupeKey", j.institution_id AS "institutionId",
  inst.name AS "institutionName", inst.code AS "institutionCode",
  j.created_by AS "createdBy", j.created_at AS "createdAt", j.updated_at AS "updatedAt"`;

type JobFilter = Partial<{
  q: string;
  status: string;
  type: string;
  queue: string;
  institutionId: string;
  workerId: string;
  module: string;
  attemptsMin: number;
  createdFrom: string;
  createdTo: string;
  startedFrom: string;
  startedTo: string;
  completedFrom: string;
  completedTo: string;
}>;

/** Parameterized WHERE fragments for the job list / export (all inputs bound). */
function jobWhere(f: JobFilter, params: unknown[]): string[] {
  const where: string[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.q)
    add(
      (n) =>
        `(j.id::text ILIKE $${n} OR j.type ILIKE $${n} OR inst.name ILIKE $${n} OR inst.code ILIKE $${n}
          OR j.created_by::text ILIKE $${n} OR j.error ILIKE $${n} OR j.queue ILIKE $${n} OR j.payload::text ILIKE $${n})`,
      `%${f.q}%`
    );
  if (f.status === "stuck") where.push(`(${STUCK_SQL})`);
  else if (f.status) add((n) => `j.status = $${n}`, f.status);
  if (f.type) add((n) => `j.type = $${n}`, f.type);
  if (f.queue) add((n) => `j.queue = $${n}`, f.queue);
  if (f.institutionId) add((n) => `j.institution_id = $${n}`, f.institutionId);
  if (f.workerId) add((n) => `j.locked_by = $${n}`, f.workerId);
  if (f.attemptsMin != null) add((n) => `j.attempts >= $${n}`, f.attemptsMin);
  if (f.createdFrom) add((n) => `j.created_at >= $${n}`, `${f.createdFrom}T00:00:00.000Z`);
  if (f.createdTo) add((n) => `j.created_at <= $${n}`, `${f.createdTo}T23:59:59.999Z`);
  if (f.startedFrom) add((n) => `j.started_at >= $${n}`, `${f.startedFrom}T00:00:00.000Z`);
  if (f.startedTo) add((n) => `j.started_at <= $${n}`, `${f.startedTo}T23:59:59.999Z`);
  if (f.completedFrom) add((n) => `j.completed_at >= $${n}`, `${f.completedFrom}T00:00:00.000Z`);
  if (f.completedTo) add((n) => `j.completed_at <= $${n}`, `${f.completedTo}T23:59:59.999Z`);
  if (f.module) {
    const known = Object.keys(SOURCE_MODULE);
    if (f.module === "Other") add((n) => `NOT (j.type = ANY($${n}))`, known);
    else {
      const types = Object.entries(SOURCE_MODULE).filter(([, m]) => m === f.module).map(([t]) => t);
      if (types.length) add((n) => `j.type = ANY($${n})`, types);
      else where.push("FALSE");
    }
  }
  return where;
}

/** Present a raw job row for the API: masked payload/error + derived fields. */
function presentJobRow(r: Record<string, unknown>): Record<string, unknown> {
  const type = r.type as string;
  const lockedAt = r.lockedAt ? new Date(r.lockedAt as string).getTime() : 0;
  return {
    ...r,
    payload: maskPayload(r.payload),
    error: mtext(r.error),
    deadLetterReason: mtext(r.deadLetterReason),
    sourceModule: moduleForType(type),
    queue: (r.queue as string | null) ?? type,
    stuck: r.status === "running" && lockedAt > 0 && lockedAt < Date.now() - 10 * 60 * 1000,
  };
}

// ============================ Window helper =================================

function windowExpr(col: string, q: { window: string; dateFrom?: string; dateTo?: string }, params: unknown[]): string {
  if (q.window === "today") return `${col} >= date_trunc('day', now())`;
  if (q.window === "24h") return `${col} >= now() - interval '24 hours'`;
  if (q.window === "7d") return `${col} >= now() - interval '7 days'`;
  if (q.window === "30d") return `${col} >= now() - interval '30 days'`;
  const parts: string[] = [];
  if (q.dateFrom) {
    params.push(`${q.dateFrom}T00:00:00.000Z`);
    parts.push(`${col} >= $${params.length}`);
  }
  if (q.dateTo) {
    params.push(`${q.dateTo}T23:59:59.999Z`);
    parts.push(`${col} <= $${params.length}`);
  }
  return parts.length ? parts.join(" AND ") : "TRUE";
}

// ============================ 1. Dashboard =================================

export async function dashboard(q: z.infer<typeof summaryQuerySchema>) {
  // Live queue snapshot (status totals + stuck) — not windowed.
  const s = (
    await query<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE status='running')::int AS running,
         count(*) FILTER (WHERE status='success')::int AS success,
         count(*) FILTER (WHERE status='failed')::int AS failed,
         count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
         count(*) FILTER (WHERE status='dead_letter')::int AS "deadLetter",
         count(*) FILTER (WHERE status='running' AND locked_at < now() - interval '10 minutes')::int AS stuck
       FROM jobs j`
    )
  ).rows[0];

  // Windowed time-scoped counts.
  const rp: unknown[] = [];
  const retried = Number(
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM job_attempts WHERE status='retry' AND ${windowExpr("created_at", q, rp)}`,
        rp
      )
    ).rows[0].n
  );
  const fp: unknown[] = [];
  const failedWindow = Number(
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jobs WHERE status='failed' AND ${windowExpr("completed_at", q, fp)}`,
        fp
      )
    ).rows[0].n
  );
  const cp: unknown[] = [];
  const completedWindow = Number(
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jobs WHERE status IN ('success','failed') AND ${windowExpr("completed_at", q, cp)}`,
        cp
      )
    ).rows[0].n
  );

  const dp: unknown[] = [];
  const avgDurationMs = Number(
    (
      await query<{ ms: number | null }>(
        `SELECT round(avg(duration_ms))::int AS ms FROM job_attempts
         WHERE status IN ('success','failed') AND duration_ms IS NOT NULL AND ${windowExpr("finished_at", q, dp)}`,
        dp
      )
    ).rows[0].ms ?? 0
  );

  const longest = (
    await query<Record<string, unknown>>(
      `SELECT id, type, started_at AS "startedAt",
              round(extract(epoch FROM (now() - started_at)) * 1000)::bigint AS "ageMs"
       FROM jobs WHERE status='running' AND started_at IS NOT NULL
       ORDER BY started_at ASC LIMIT 1`
    )
  ).rows[0] ?? null;

  const workers = (
    await query<{ total: number; active: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE last_heartbeat_at >= now() - interval '5 minutes')::int AS active
       FROM worker_heartbeats`
    )
  ).rows[0];

  const sched = (
    await query<{ lastEnqueue: Date | null; lastHeartbeat: Date | null }>(
      `SELECT (SELECT max(created_at) FROM jobs WHERE type = ANY($1)) AS "lastEnqueue",
              (SELECT max(last_heartbeat_at) FROM worker_heartbeats) AS "lastHeartbeat"`,
      [SCHEDULED_TYPES]
    )
  ).rows[0];
  const lastTick =
    [sched.lastEnqueue, sched.lastHeartbeat].filter(Boolean).map((d) => new Date(d as Date).getTime()).sort((a, b) => b - a)[0] ??
    null;

  const recentAlerts = (
    await query<Record<string, unknown>>(
      `SELECT id, rule_name AS "ruleName", type, severity, status, service, triggered_at AS "triggeredAt"
       FROM alerts WHERE type = ANY($1) ORDER BY triggered_at DESC LIMIT 5`,
      [JOB_ALERT_TYPES]
    )
  ).rows;

  const pending = Number(s.pending);
  const running = Number(s.running);
  const failed = Number(s.failed);
  const deadLetter = Number(s.deadLetter);
  const stuck = Number(s.stuck);

  return {
    window: q.window,
    statuses: {
      pending,
      running,
      success: Number(s.success),
      failed,
      cancelled: Number(s.cancelled),
      dead_letter: deadLetter,
    },
    queueDepth: pending + running,
    stuck,
    retriedInWindow: retried,
    failedInWindow: failedWindow,
    failureRatePct: completedWindow > 0 ? Math.round((failedWindow / completedWindow) * 10000) / 100 : 0,
    avgJobDurationMs: avgDurationMs,
    longestRunningJob: longest
      ? { id: longest.id, type: longest.type, startedAt: longest.startedAt, ageMs: Number(longest.ageMs) }
      : null,
    workers: { total: Number(workers.total), active: Number(workers.active) },
    scheduler: {
      lastTickAt: lastTick ? new Date(lastTick).toISOString() : null,
      status: lastTick ? "on_demand" : "idle",
      note: "The worker/scheduler runs on-demand (no resident broker).",
    },
    jobsNeedingAttention: failed + deadLetter + stuck,
    recentAlerts,
  };
}

// ============================ 2. List ======================================

const SORT_COLS: Record<string, string> = {
  created_at: "j.created_at",
  started_at: "j.started_at",
  completed_at: "j.completed_at",
  status: "j.status",
  attempts: "j.attempts",
};

export async function listJobs(q: z.infer<typeof listJobsQuerySchema>) {
  const params: unknown[] = [];
  const where = jobWhere(q, params);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n ${JOBS_FROM} ${whereSql}`, params)).rows[0].n
  );
  const sortCol = SORT_COLS[q.sort] ?? "j.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${JOB_COLS} ${JOBS_FROM} ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, j.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(presentJobRow), total, page: q.page, pageSize: q.pageSize };
}

// ============================ 3. Detail + attempts =========================

async function loadJob(id: string): Promise<{ status: string; type: string; institutionId: string | null }> {
  const { rows } = await query<{ status: string; type: string; institutionId: string | null }>(
    `SELECT status, type, institution_id AS "institutionId" FROM jobs WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Job not found");
  return rows[0];
}

function buildRelatedLinks(institutionId: string | null, payload: Record<string, unknown>): { type: string; id: string; key: string }[] {
  const links: { type: string; id: string; key: string }[] = [];
  if (institutionId) links.push({ type: "institution", id: institutionId, key: "institutionId" });
  for (const [k, t] of Object.entries(LINK_KEYS)) {
    if (k === "institutionId") continue;
    const v = payload[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 100) links.push({ type: t, id: v, key: k });
  }
  return links;
}

async function attemptRows(id: string) {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, attempt_number AS "attemptNumber", status, worker_id AS "workerId",
            started_at AS "startedAt", finished_at AS "finishedAt", duration_ms AS "durationMs",
            error, retry_reason AS "retryReason", backoff_ms AS "backoffMs",
            next_retry_at AS "nextRetryAt", result_summary AS "resultSummary", created_at AS "createdAt"
     FROM job_attempts WHERE job_id = $1 ORDER BY attempt_number ASC, created_at ASC`,
    [id]
  );
  return rows.map((r) => ({ ...r, error: mtext(r.error), resultSummary: mtext(r.resultSummary) }));
}

function retryPolicyForType(type: string) {
  return {
    maxAttempts: 3,
    backoffStrategy: "exponential",
    backoffBaseMs: BACKOFF_BASE_MS,
    module: moduleForType(type),
    note: "Enforced by the worker; per-type editable policies are a future enhancement.",
  };
}

export async function getJob(id: string) {
  const { rows } = await query<Record<string, unknown>>(`SELECT ${JOB_COLS} ${JOBS_FROM} WHERE j.id = $1`, [id]);
  const row = rows[0];
  if (!row) throw ApiError.notFound("Job not found");
  const rawPayload = (row.payload ?? {}) as Record<string, unknown>;
  const recentAudit = (
    await query<Record<string, unknown>>(
      `SELECT id, action, actor_email AS "actorEmail", actor_role AS "actorRole", detail, created_at AS "createdAt"
       FROM platform_audit_log WHERE target_type='job' AND target_id::text = $1
       ORDER BY created_at DESC LIMIT 20`,
      [id]
    )
  ).rows.map((r) => ({ ...r, detail: maskSecrets((r.detail ?? {}) as Record<string, unknown>) }));

  return {
    ...presentJobRow(row),
    relatedLinks: buildRelatedLinks(row.institutionId as string | null, rawPayload),
    attempts: await attemptRows(id),
    recentAudit,
    retryPolicy: retryPolicyForType(row.type as string),
  };
}

export async function attempts(id: string) {
  await loadJob(id); // 404 if the job is missing
  return { rows: await attemptRows(id) };
}

// ============================ 4. Single-job actions ========================

async function applyRetry(id: string): Promise<string> {
  const job = await loadJob(id);
  if (job.status !== "failed" && job.status !== "dead_letter") {
    throw ApiError.badRequest(`Cannot retry a ${job.status} job — only failed or dead-letter jobs can be retried`);
  }
  await query(
    `UPDATE jobs SET status='pending', attempts=0, run_at=now(), error=NULL,
       locked_at=NULL, locked_by=NULL, started_at=NULL, completed_at=NULL,
       dead_lettered_at=NULL, dead_letter_reason=NULL, updated_at=now()
     WHERE id=$1`,
    [id]
  );
  return job.status;
}

async function applyCancel(id: string): Promise<void> {
  const job = await loadJob(id);
  if (job.status !== "pending") {
    throw ApiError.badRequest(`Cannot cancel a ${job.status} job — only pending jobs can be cancelled`);
  }
  await query("UPDATE jobs SET status='cancelled', completed_at=now(), updated_at=now() WHERE id=$1", [id]);
}

export async function retryJob(id: string, reason: string | undefined, actor: Actor) {
  const job = await loadJob(id);
  const from = await applyRetry(id);
  await recordAudit(actor, {
    action: "jobs.retried",
    targetId: id,
    institutionId: job.institutionId,
    detail: { from, type: job.type, reason: mtext(reason) },
  });
  return getJob(id);
}

export async function cancelJob(id: string, reason: string | undefined, actor: Actor) {
  const job = await loadJob(id);
  await applyCancel(id);
  await recordAudit(actor, {
    action: "jobs.cancelled",
    targetId: id,
    institutionId: job.institutionId,
    detail: { type: job.type, reason: mtext(reason) },
  });
  return getJob(id);
}

export async function deadLetter(id: string, reason: string, actor: Actor) {
  const job = await loadJob(id);
  await moveToDeadLetter(id, reason, actor); // enforces failed → dead_letter
  await recordAudit(actor, {
    action: "jobs.dead_lettered",
    targetId: id,
    institutionId: job.institutionId,
    detail: { type: job.type, reason: mtext(reason) },
  });
  await recordSecurityEvent({
    action: "jobs.dead_lettered",
    targetType: "job",
    targetId: id,
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    institutionId: job.institutionId,
    detail: { type: job.type },
    ip: actor.ip,
  });
  return getJob(id);
}

export async function requeue(id: string, reason: string, actor: Actor) {
  const job = await loadJob(id);
  await requeueFromDeadLetter(id, actor); // enforces dead_letter → pending
  await recordAudit(actor, {
    action: "jobs.requeued",
    targetId: id,
    institutionId: job.institutionId,
    detail: { type: job.type, reason: mtext(reason) },
  });
  return getJob(id);
}

// ============================ 5. Bulk ======================================

export async function bulk(input: z.infer<typeof bulkSchema>, actor: Actor) {
  const ids = [...new Set(input.ids)];
  let affected = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      if (input.action === "retry") await applyRetry(id);
      else if (input.action === "cancel") await applyCancel(id);
      else await moveToDeadLetter(id, input.reason, actor);
      affected += 1;
    } catch (err) {
      skipped.push({ id, reason: err instanceof ApiError ? err.message : "Skipped" });
    }
  }
  await recordAudit(actor, {
    action: "jobs.bulk_action",
    targetId: null,
    detail: { action: input.action, requested: ids.length, affected, skipped: skipped.length, reason: mtext(input.reason) },
  });
  await recordSecurityEvent({
    action: "jobs.bulk_action",
    targetType: "job",
    targetId: null,
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    detail: { action: input.action, requested: ids.length, affected },
    ip: actor.ip,
  });
  return { requested: ids.length, affected, skipped };
}

// ============================ 6. Dead-letter list ==========================

export async function deadLetterList(q: z.infer<typeof deadLetterQuerySchema>) {
  const params: unknown[] = [];
  const where = ["j.status='dead_letter'"];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.q)
    add(
      (n) => `(j.id::text ILIKE $${n} OR j.type ILIKE $${n} OR j.dead_letter_reason ILIKE $${n} OR inst.name ILIKE $${n})`,
      `%${q.q}%`
    );
  if (q.type) add((n) => `j.type = $${n}`, q.type);
  if (q.institutionId) add((n) => `j.institution_id = $${n}`, q.institutionId);
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n ${JOBS_FROM} ${whereSql}`, params)).rows[0].n
  );
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${JOB_COLS} ${JOBS_FROM} ${whereSql}
     ORDER BY j.dead_lettered_at DESC NULLS LAST, j.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows: rows.map(presentJobRow), total, page: q.page, pageSize: q.pageSize };
}

// ============================ 7. Workers ===================================

export async function workers() {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT worker_id AS "workerId", last_heartbeat_at AS "lastHeartbeatAt", current_job_id AS "currentJobId",
            jobs_processed AS "jobsProcessed", jobs_failed AS "jobsFailed", queue, hostname, version,
            first_seen_at AS "firstSeenAt", updated_at AS "updatedAt"
     FROM worker_heartbeats ORDER BY last_heartbeat_at DESC`
  );
  const now = Date.now();
  const workerRows = rows.map((r) => {
    const ageMs = now - new Date(r.lastHeartbeatAt as string).getTime();
    const status = ageMs < 5 * 60 * 1000 ? "online" : ageMs < 30 * 60 * 1000 ? "degraded" : "offline";
    return {
      ...r,
      status,
      lastHeartbeatAgeMs: ageMs,
      jobsProcessed: Number(r.jobsProcessed),
      jobsFailed: Number(r.jobsFailed),
    };
  });
  return {
    workers: workerRows,
    note: "The queue worker is on-demand (no resident broker); a worker appears here after it processes a run.",
  };
}

// ============================ 8. Process / scheduler =======================

export async function processNow(actor: Actor) {
  const result = await processDueJobs({ limit: 50, workerId: `console-${actor.id}` });
  await recordAudit(actor, { action: "jobs.processed", targetId: null, detail: result });
  return result;
}

export async function runScheduler(actor: Actor) {
  const reports = await runSchedulerTick(null);
  const backups = await enqueueDueScheduledBackups();
  const exports = await enqueueDueScheduledExports();
  const counts = { reports, backups, exports };
  await recordAudit(actor, { action: "jobs.scheduler_run", targetId: null, detail: counts });
  return counts;
}

// ============================ 9. Schedules =================================

export async function schedules() {
  const out: Record<string, unknown>[] = [];

  const reports = (
    await query<Record<string, unknown>>(
      `SELECT sr.id, sr.name, sr.frequency, sr.enabled, sr.run_time AS "runTime",
              sr.next_run_at AS "nextRunAt", sr.last_run_at AS "lastRunAt", inst.name AS "institutionName"
       FROM scheduled_reports sr LEFT JOIN institutions inst ON inst.id = sr.institution_id
       ORDER BY sr.created_at DESC LIMIT 500`
    )
  ).rows;
  for (const r of reports)
    out.push({
      source: "reports",
      id: r.id,
      name: (r.name as string) ?? "Scheduled report",
      jobType: "scheduled_report_run",
      frequency: r.frequency,
      enabled: r.enabled,
      status: r.enabled ? "active" : "paused",
      lastRunAt: r.lastRunAt,
      lastStatus: null,
      nextRunAt: r.nextRunAt,
      institutionName: r.institutionName,
      critical: false,
    });

  // The backup schedule is a global singleton — always surfaced (defaults to
  // disabled when the settings row has not been initialised yet).
  const bs =
    (
      await query<Record<string, unknown>>(
        `SELECT schedule_enabled AS "enabled", schedule_frequency AS "frequency",
                schedule_run_time AS "runTime", next_run_at AS "nextRunAt" FROM backup_settings WHERE id = 1`
      )
    ).rows[0] ?? { enabled: false, frequency: "daily", runTime: "02:00", nextRunAt: null };
  const lastBackup = (
    await query<Record<string, unknown>>(
      `SELECT status, completed_at AS "completedAt" FROM backups WHERE trigger='scheduled' ORDER BY created_at DESC LIMIT 1`
    )
  ).rows[0];
  out.push({
    source: "backup",
    id: "global",
    name: "Automated backup",
    jobType: "scheduled_backup",
    frequency: bs.frequency,
    enabled: Boolean(bs.enabled),
    status: bs.enabled ? "active" : "paused",
    lastRunAt: lastBackup?.completedAt ?? null,
    lastStatus: lastBackup?.status ?? null,
    nextRunAt: bs.nextRunAt,
    critical: true,
  });

  const exps = (
    await query<Record<string, unknown>>(
      `SELECT id, name, frequency, enabled, run_time AS "runTime", next_run_at AS "nextRunAt",
              last_run_at AS "lastRunAt", last_status AS "lastStatus"
       FROM export_schedules ORDER BY created_at DESC LIMIT 500`
    )
  ).rows;
  for (const e of exps)
    out.push({
      source: "export",
      id: e.id,
      name: (e.name as string) ?? "Scheduled export",
      jobType: "scheduled_export",
      frequency: e.frequency,
      enabled: e.enabled,
      status: e.enabled ? "active" : "paused",
      lastRunAt: e.lastRunAt,
      lastStatus: e.lastStatus,
      nextRunAt: e.nextRunAt,
      critical: false,
    });

  for (const sys of SYSTEM_SCHEDULES)
    out.push({
      source: "system",
      id: sys.id,
      name: sys.name,
      jobType: sys.jobType,
      frequency: "each worker tick",
      enabled: true,
      status: "active",
      lastRunAt: null,
      lastStatus: null,
      nextRunAt: null,
      critical: false,
      note: "Runs on every worker tick — cannot be paused.",
    });

  return { schedules: out };
}

function assertScheduleUuid(id: string, label: string): void {
  if (!UUID_RE.test(id)) throw ApiError.notFound(`${label} not found`);
}

async function toggleSchedule(source: string, id: string, enable: boolean): Promise<void> {
  if (source === "reports") {
    assertScheduleUuid(id, "Scheduled report");
    const res = await query("UPDATE scheduled_reports SET enabled=$2 WHERE id=$1", [id, enable]);
    if (!res.rowCount) throw ApiError.notFound("Scheduled report not found");
  } else if (source === "export") {
    assertScheduleUuid(id, "Export schedule");
    const res = await query("UPDATE export_schedules SET enabled=$2 WHERE id=$1", [id, enable]);
    if (!res.rowCount) throw ApiError.notFound("Export schedule not found");
  } else if (source === "backup") {
    // Upsert the singleton so a pause/resume persists even before it's initialised.
    await query(
      `INSERT INTO backup_settings (id, schedule_enabled) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET schedule_enabled = $1`,
      [enable]
    );
  } else {
    throw ApiError.badRequest("Unknown schedule source");
  }
}

async function runScheduleNow(source: string, id: string) {
  if (source === "reports") {
    assertScheduleUuid(id, "Scheduled report");
    const sr = (
      await query<{ institutionId: string; createdBy: string | null }>(
        `SELECT institution_id AS "institutionId", created_by AS "createdBy" FROM scheduled_reports WHERE id=$1`,
        [id]
      )
    ).rows[0];
    if (!sr) throw ApiError.notFound("Scheduled report not found");
    return enqueue({
      type: "scheduled_report_run",
      payload: { scheduleId: id },
      institutionId: sr.institutionId,
      createdBy: sr.createdBy,
      dedupeKey: `sched:${id}:manual:${Date.now()}`,
    });
  }
  if (source === "export") {
    assertScheduleUuid(id, "Export schedule");
    const es = (await query<{ id: string }>(`SELECT id FROM export_schedules WHERE id=$1`, [id])).rows[0];
    if (!es) throw ApiError.notFound("Export schedule not found");
    return enqueue({
      type: "scheduled_export",
      payload: { scheduleId: id },
      dedupeKey: `export:${id}:manual:${Date.now()}`,
    });
  }
  if (source === "backup") {
    return enqueue({ type: "scheduled_backup", payload: { scope: "global" }, dedupeKey: `backup:manual:${Date.now()}` });
  }
  throw ApiError.badRequest("Unknown schedule source");
}

export async function scheduleAction(
  source: string,
  id: string,
  input: z.infer<typeof scheduleActionSchema>,
  actor: Actor
) {
  const { action, reason } = input;

  if (source === "system") {
    if (action !== "run_now") throw ApiError.badRequest("A system schedule cannot be paused or resumed");
    let result: unknown;
    if (id === "subscription_lifecycle") result = await sweepSubscriptionLifecycle();
    else if (id === "alert_evaluation") result = await evaluateAlertRules();
    else throw ApiError.notFound("Unknown system schedule");
    await recordAudit(actor, {
      action: "jobs.schedule_run_now",
      targetId: null,
      detail: { source, id, reason: mtext(reason) },
    });
    return { source, id, action, result };
  }

  if (action === "run_now") {
    // run_now on the critical (backup) schedule requires a reason.
    if (source === "backup" && (!reason || reason.trim().length < 5)) {
      throw ApiError.badRequest("Running the automated backup now requires a reason (≥5 characters)");
    }
    const job = await runScheduleNow(source, id);
    await recordAudit(actor, {
      action: "jobs.schedule_run_now",
      targetId: (job?.id as string) ?? null,
      detail: { source, scheduleId: id, reason: mtext(reason) },
    });
    return { source, id, action, enqueued: Boolean(job), jobId: (job?.id as string) ?? null };
  }

  // pause / resume.
  const enable = action === "resume";
  const critical = source === "backup";
  if (action === "pause" && critical && (!reason || reason.trim().length < 5)) {
    throw ApiError.badRequest("Pausing the automated backup schedule requires a reason (≥5 characters)");
  }
  await toggleSchedule(source, id, enable);
  await recordAudit(actor, {
    action: enable ? "jobs.schedule_resumed" : "jobs.schedule_paused",
    targetId: null,
    detail: { source, scheduleId: id, reason: mtext(reason) },
  });
  if (action === "pause" && critical) {
    await recordSecurityEvent({
      // target_id is a UUID column and a schedule "id" may be a non-uuid key
      // (e.g. the backup singleton "global") — carry it in detail instead.
      action: "jobs.schedule_paused",
      targetType: "job_schedule",
      targetId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      detail: { source, scheduleId: id },
      ip: actor.ip,
    });
  }
  return { source, id, action, enabled: enable };
}

// ============================ 10. Retry policy =============================

export async function retryPolicy() {
  const perType = (
    await query<Record<string, number | string>>(
      `SELECT type, min(max_attempts)::int AS "minMaxAttempts", max(max_attempts)::int AS "maxMaxAttempts",
              count(*)::int AS jobs
       FROM jobs GROUP BY type ORDER BY type`
    )
  ).rows;
  return {
    default: {
      maxAttempts: 3,
      backoffStrategy: "exponential",
      backoffBaseMs: BACKOFF_BASE_MS,
      formula: "backoffBaseMs * 2^(attempt-1)",
    },
    perType: perType.map((r) => ({
      type: r.type,
      module: moduleForType(r.type as string),
      minMaxAttempts: Number(r.minMaxAttempts),
      maxMaxAttempts: Number(r.maxMaxAttempts),
      jobs: Number(r.jobs),
    })),
    note: "Retry policy is enforced by the worker (fixed exponential backoff). Per-type editable policies are a future enhancement.",
  };
}

// ============================ 11. Job alerts (reuse L store) ===============

const ALERT_SELECT = `
  id, rule_id AS "ruleId", rule_name AS "ruleName", type, severity, status, service,
  metric_value AS "metricValue", threshold, incident_id AS "incidentId", note,
  triggered_at AS "triggeredAt", acknowledged_by AS "acknowledgedBy", acknowledged_at AS "acknowledgedAt",
  resolved_by AS "resolvedBy", resolved_at AS "resolvedAt", created_at AS "createdAt"`;

export async function alerts(q: z.infer<typeof alertListQuerySchema>) {
  const params: unknown[] = [JOB_ALERT_TYPES];
  const where = ["type = ANY($1)"];
  if (q.status) {
    params.push(q.status);
    where.push(`status = $${params.length}`);
  }
  if (q.severity) {
    params.push(q.severity);
    where.push(`severity = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM alerts ${whereSql}`, params)).rows[0].n
  );
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${ALERT_SELECT} FROM alerts ${whereSql}
     ORDER BY triggered_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return {
    rows: rows.map((r) => ({ ...r, note: mtext(r.note) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Guard: only job/worker/scheduler alerts are reachable through this surface. */
async function assertJobAlert(id: string): Promise<void> {
  const { rows } = await query<{ type: string | null }>("SELECT type FROM alerts WHERE id=$1", [id]);
  if (!rows[0]) throw ApiError.notFound("Alert not found");
  if (!rows[0].type || !JOB_ALERT_TYPES.includes(rows[0].type)) {
    throw ApiError.badRequest("This alert is not a job alert");
  }
}

export async function ackAlert(id: string, note: string | undefined, actor: Actor) {
  await assertJobAlert(id);
  const result = await lAckAlert(id, { note }, actor); // reuses L's one store (audits alert.acknowledged)
  await recordAudit(actor, { action: "jobs.alert_acknowledged", targetType: "alert", targetId: id, detail: {} });
  return result;
}

export async function resolveAlert(id: string, note: string | undefined, actor: Actor) {
  await assertJobAlert(id);
  const result = await lResolveAlert(id, { note }, actor);
  await recordAudit(actor, { action: "jobs.alert_resolved", targetType: "alert", targetId: id, detail: {} });
  return result;
}

// ============================ 12. Reports ==================================

function reportWhere(f: z.infer<typeof reportsQuerySchema>, params: unknown[]): string {
  const where: string[] = [windowExpr("j.created_at", f, params)];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (f.type) add((n) => `j.type = $${n}`, f.type);
  if (f.status === "stuck") where.push(`(${STUCK_SQL})`);
  else if (f.status) add((n) => `j.status = $${n}`, f.status);
  if (f.queue) add((n) => `j.queue = $${n}`, f.queue);
  if (f.workerId) add((n) => `j.locked_by = $${n}`, f.workerId);
  if (f.institutionId) add((n) => `j.institution_id = $${n}`, f.institutionId);
  if (f.module) {
    const known = Object.keys(SOURCE_MODULE);
    if (f.module === "Other") add((n) => `NOT (j.type = ANY($${n}))`, known);
    else {
      const types = Object.entries(SOURCE_MODULE).filter(([, m]) => m === f.module).map(([t]) => t);
      if (types.length) add((n) => `j.type = ANY($${n})`, types);
      else where.push("FALSE");
    }
  }
  return where.join(" AND ");
}

export async function reports(f: z.infer<typeof reportsQuerySchema>) {
  const jw = (params: unknown[]) => reportWhere(f, params);

  const p1: unknown[] = [];
  const volumeByType = (
    await query(`SELECT j.type, count(*)::int AS count ${JOBS_FROM} WHERE ${jw(p1)} GROUP BY j.type ORDER BY count DESC`, p1)
  ).rows;

  const p2: unknown[] = [];
  const statusSummary = (
    await query<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE j.status='pending')::int AS pending,
         count(*) FILTER (WHERE j.status='running')::int AS running,
         count(*) FILTER (WHERE j.status='success')::int AS success,
         count(*) FILTER (WHERE j.status='failed')::int AS failed,
         count(*) FILTER (WHERE j.status='cancelled')::int AS cancelled,
         count(*) FILTER (WHERE j.status='dead_letter')::int AS "deadLetter"
       ${JOBS_FROM} WHERE ${jw(p2)}`,
      p2
    )
  ).rows[0];

  const p3: unknown[] = [];
  const failureReport = (
    await query(
      `SELECT j.type, count(*)::int AS failures ${JOBS_FROM} WHERE ${jw(p3)} AND j.status='failed'
       GROUP BY j.type ORDER BY failures DESC LIMIT 50`,
      p3
    )
  ).rows;

  const p4: unknown[] = [];
  const retryReport = (
    await query(
      `SELECT j.type, count(*)::int AS retries
       FROM job_attempts ja JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN institutions inst ON inst.id = j.institution_id
       WHERE ja.status='retry' AND ${jw(p4)} GROUP BY j.type ORDER BY retries DESC LIMIT 50`,
      p4
    )
  ).rows;

  const p5: unknown[] = [];
  const deadLetterReport = (
    await query(
      `SELECT j.type, count(*)::int AS count ${JOBS_FROM} WHERE ${jw(p5)} AND j.status='dead_letter'
       GROUP BY j.type ORDER BY count DESC LIMIT 50`,
      p5
    )
  ).rows;

  const p6: unknown[] = [];
  const schedulerRunReport = (
    await query(
      `SELECT j.type, j.status, count(*)::int AS count ${JOBS_FROM}
       WHERE ${jw(p6)} AND j.type = ANY($${p6.length + 1})
       GROUP BY j.type, j.status ORDER BY j.type, j.status`,
      [...p6, SCHEDULED_TYPES]
    )
  ).rows;

  const p7: unknown[] = [];
  const moduleRaw = (
    await query<Record<string, unknown>>(
      `SELECT j.type, count(*)::int AS count, count(*) FILTER (WHERE j.status='failed')::int AS failed
       ${JOBS_FROM} WHERE ${jw(p7)} GROUP BY j.type`,
      p7
    )
  ).rows;
  const moduleAgg: Record<string, { module: string; count: number; failed: number }> = {};
  for (const r of moduleRaw) {
    const m = moduleForType(r.type as string);
    moduleAgg[m] ??= { module: m, count: 0, failed: 0 };
    moduleAgg[m].count += Number(r.count);
    moduleAgg[m].failed += Number(r.failed);
  }

  const longRunningJobs = (
    await query<Record<string, unknown>>(
      `SELECT j.id, j.type, j.started_at AS "startedAt",
              round(extract(epoch FROM (now() - j.started_at)) * 1000)::bigint AS "ageMs"
       FROM jobs j WHERE j.status='running' AND j.started_at IS NOT NULL
       ORDER BY j.started_at ASC LIMIT 20`
    )
  ).rows.map((r) => ({ ...r, ageMs: Number(r.ageMs) }));

  const queue = (
    await query<{ pending: number; running: number }>(
      `SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
              count(*) FILTER (WHERE status='running')::int AS running FROM jobs`
    )
  ).rows[0];

  const workerPerformance = (
    await query<Record<string, unknown>>(
      `SELECT worker_id AS "workerId", jobs_processed AS "jobsProcessed", jobs_failed AS "jobsFailed",
              last_heartbeat_at AS "lastHeartbeatAt", hostname, version
       FROM worker_heartbeats ORDER BY jobs_processed DESC LIMIT 50`
    )
  ).rows.map((r) => ({ ...r, jobsProcessed: Number(r.jobsProcessed), jobsFailed: Number(r.jobsFailed) }));

  return {
    window: f.window,
    volumeByType: volumeByType.map((r) => ({ type: r.type, count: Number(r.count) })),
    statusSummary: {
      pending: Number(statusSummary.pending),
      running: Number(statusSummary.running),
      success: Number(statusSummary.success),
      failed: Number(statusSummary.failed),
      cancelled: Number(statusSummary.cancelled),
      dead_letter: Number(statusSummary.deadLetter),
    },
    failureReport: failureReport.map((r) => ({ type: r.type, failures: Number(r.failures) })),
    retryReport: retryReport.map((r) => ({ type: r.type, retries: Number(r.retries) })),
    deadLetterReport: deadLetterReport.map((r) => ({ type: r.type, count: Number(r.count) })),
    schedulerRunReport: schedulerRunReport.map((r) => ({ type: r.type, status: r.status, count: Number(r.count) })),
    moduleWise: Object.values(moduleAgg).sort((a, b) => b.count - a.count),
    queueDepth: { pending: Number(queue.pending), running: Number(queue.running), total: Number(queue.pending) + Number(queue.running) },
    longRunningJobs,
    workerPerformance,
  };
}

// ============================ 13. Export ===================================

export const EXPORT_COLUMNS = [
  { key: "id", label: "Job ID" },
  { key: "type", label: "Type" },
  { key: "module", label: "Module" },
  { key: "status", label: "Status" },
  { key: "queue", label: "Queue" },
  { key: "priority", label: "Priority" },
  { key: "attempts", label: "Attempts" },
  { key: "maxAttempts", label: "Max attempts" },
  { key: "institution", label: "Tenant" },
  { key: "createdAt", label: "Created" },
  { key: "startedAt", label: "Started" },
  { key: "completedAt", label: "Completed" },
  { key: "runAt", label: "Run at" },
  { key: "worker", label: "Worker" },
  { key: "error", label: "Error (masked)" },
  { key: "payload", label: "Payload (masked)" },
  { key: "attemptHistory", label: "Attempts logged" },
];

function summarizePayload(masked: Record<string, unknown>): string {
  const keys = Object.keys(masked);
  if (keys.length === 0) return "";
  const s = JSON.stringify(masked);
  return s.length > 500 ? `${s.slice(0, 497)}...` : s;
}

export async function exportRows(q: z.infer<typeof exportQuerySchema>) {
  const params: unknown[] = [];
  const where = jobWhere(q, params);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${JOB_COLS},
            to_char(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtIso",
            to_char(j.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startedAtIso",
            to_char(j.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "completedAtIso",
            to_char(j.run_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "runAtIso",
            (SELECT count(*)::int FROM job_attempts a WHERE a.job_id = j.id) AS "attemptHistory"
     ${JOBS_FROM} ${whereSql} ORDER BY j.created_at DESC LIMIT 50000`,
    params
  );
  return rows.map((r) => {
    const masked = maskPayload(r.payload);
    return {
      id: r.id,
      type: r.type,
      module: moduleForType(r.type as string),
      status: r.status,
      queue: (r.queue as string | null) ?? r.type,
      priority: r.priority,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      institution: r.institutionName ?? "",
      createdAt: r.createdAtIso ?? "",
      startedAt: r.startedAtIso ?? "",
      completedAt: r.completedAtIso ?? "",
      runAt: r.runAtIso ?? "",
      worker: r.lockedBy ?? "",
      error: mtext(r.error) ?? "",
      payload: summarizePayload(masked),
      attemptHistory: q.includeAttempts ? Number(r.attemptHistory) : "",
    } as Record<string, unknown>;
  });
}

/** Audit a jobs export (the route calls this after building the rows). High-risk
 *  broad read → also a security event. */
export async function recordExportAudit(
  actor: Actor,
  detail: { format: string; count: number; reason: string }
): Promise<void> {
  await recordAudit(actor, {
    action: "jobs.exported",
    targetId: null,
    detail: { format: detail.format, count: detail.count, reason: mtext(detail.reason) },
  });
  await recordSecurityEvent({
    action: "jobs.exported",
    targetType: "job",
    targetId: null,
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    detail: { format: detail.format, count: detail.count },
    ip: actor.ip,
  });
}

// ============================ 14. Integrations ============================

export async function integrations() {
  const jh = await jobsHealth().catch(() => null);
  const auditRow = (
    await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform_audit_log
       WHERE action LIKE 'jobs.%' AND created_at >= now() - interval '24 hours'`
    )
  ).rows[0];
  const critAlerts = (
    await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alerts
       WHERE type = ANY($1) AND severity='critical' AND status <> 'resolved'`,
      [JOB_ALERT_TYPES]
    )
  ).rows[0];

  return {
    observability: jh
      ? {
          queue: jh.queue,
          stuck: jh.stuck,
          failedTrend: jh.failedTrend,
          processed: jh.processed,
          workerEnabled: jh.workerEnabled,
        }
      : { unavailable: true },
    audit: { jobActions24h: Number(auditRow.n) },
    security: { criticalJobAlerts: Number(critAlerts.n) },
    links: { observability: "/observability", audit: "/platform/audit", security: "/platform/security" },
  };
}
