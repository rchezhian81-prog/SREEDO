import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { computeNextRun } from "../scheduledreports/scheduledreports.service";
import type { listJobsQuerySchema } from "./jobs.schema";

/** A super_admin's scope is `null` (all institutions); a tenant admin's scope is
 *  their own institution id, so they never see other tenants' jobs. */
export type Scope = string | null;

const SELECT = `
  id, type, payload, status, priority, attempts, max_attempts AS "maxAttempts",
  run_at AS "runAt", locked_at AS "lockedAt", locked_by AS "lockedBy",
  started_at AS "startedAt", completed_at AS "completedAt", error,
  dedupe_key AS "dedupeKey", institution_id AS "institutionId",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

/** Appends an `institution_id = $n` filter for tenant scope (no-op for super_admin). */
function scopeClause(scope: Scope, params: unknown[]): string {
  if (scope === null) return "";
  params.push(scope);
  return ` AND institution_id = $${params.length}`;
}

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date | string | null;
  dedupeKey?: string | null;
  institutionId?: string | null;
  createdBy?: string | null;
}

/** Enqueues a job. Returns the created row, or null when a non-null dedupe_key
 *  already exists (idempotent enqueue). Payloads must never carry secrets. */
export async function enqueue(input: EnqueueInput) {
  const { rows } = await query(
    `INSERT INTO jobs (type, payload, priority, max_attempts, run_at, dedupe_key, institution_id, created_by)
     VALUES ($1,$2::jsonb,$3,$4,COALESCE($5, now()),$6,$7,$8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING ${SELECT}`,
    [
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.priority ?? 0,
      input.maxAttempts ?? 3,
      input.runAt ?? null,
      input.dedupeKey ?? null,
      input.institutionId ?? null,
      input.createdBy ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function listJobs(scope: Scope, filters: z.infer<typeof listJobsQuerySchema>) {
  const params: unknown[] = [];
  const where: string[] = [];
  // Tenant scope first (forced); super_admin may optionally filter by institution.
  const sc = scopeClause(scope, params);
  if (sc) where.push(sc.replace(/^ AND /, ""));
  else if (filters.institutionId) {
    params.push(filters.institutionId);
    where.push(`institution_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.type) {
    params.push(filters.type);
    where.push(`type = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(`${filters.dateFrom}T00:00:00.000Z`);
    where.push(`created_at >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(`${filters.dateTo}T23:59:59.999Z`);
    where.push(`created_at <= $${params.length}`);
  }
  params.push(filters.limit ?? 100);
  const { rows } = await query(
    `SELECT ${SELECT} FROM jobs
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function getJob(id: string, scope: Scope) {
  const params: unknown[] = [id];
  const sc = scopeClause(scope, params);
  const { rows } = await query(`SELECT ${SELECT} FROM jobs WHERE id = $1${sc}`, params);
  if (!rows[0]) throw ApiError.notFound("Job not found");
  return rows[0];
}

export async function retryJob(id: string, scope: Scope) {
  const job = (await getJob(id, scope)) as { status: string };
  if (job.status !== "failed") throw ApiError.badRequest("Only failed jobs can be retried");
  await query(
    `UPDATE jobs SET status='pending', attempts=0, run_at=now(), error=NULL,
       locked_at=NULL, locked_by=NULL, started_at=NULL, completed_at=NULL
     WHERE id=$1`,
    [id]
  );
  return getJob(id, scope);
}

export async function cancelJob(id: string, scope: Scope) {
  const job = (await getJob(id, scope)) as { status: string };
  if (job.status !== "pending") throw ApiError.badRequest("Only pending jobs can be cancelled");
  await query("UPDATE jobs SET status='cancelled', completed_at=now() WHERE id=$1", [id]);
  return getJob(id, scope);
}

/** Scheduler tick: enqueue a job for each due Scheduled Report (deduped per
 *  schedule+window) and advance its next_run_at, so it runs automatically via the
 *  worker. Scoped to the actor's institution (all institutions for super_admin). */
export async function runSchedulerTick(scope: Scope) {
  const params: unknown[] = [];
  const sc = scopeClause(scope, params);
  const { rows: due } = await query<{
    id: string;
    institutionId: string;
    createdBy: string | null;
    frequency: string;
    runTime: string;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    nextRunAt: string;
  }>(
    `SELECT id, institution_id AS "institutionId", created_by AS "createdBy",
            frequency, run_time AS "runTime", day_of_week AS "dayOfWeek",
            day_of_month AS "dayOfMonth", next_run_at AS "nextRunAt"
     FROM scheduled_reports
     WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= now()${sc}
     ORDER BY next_run_at`,
    params
  );

  let enqueued = 0;
  for (const s of due) {
    const job = await enqueue({
      type: "scheduled_report_run",
      payload: { scheduleId: s.id },
      institutionId: s.institutionId,
      createdBy: s.createdBy,
      dedupeKey: `sched:${s.id}:${new Date(s.nextRunAt).toISOString()}`,
    });
    if (job) enqueued += 1;
    await query("UPDATE scheduled_reports SET next_run_at = $2 WHERE id = $1", [
      s.id,
      computeNextRun(s.frequency, s.runTime, s.dayOfWeek, s.dayOfMonth),
    ]);
  }
  return { due: due.length, enqueued };
}
