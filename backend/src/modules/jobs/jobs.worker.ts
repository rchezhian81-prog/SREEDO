import os from "node:os";
import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { maskFreeText } from "../platform/audit.service";
import { recordJob } from "../../observability/metrics";
import { executeScheduledById } from "../scheduledreports/scheduledreports.service";
import {
  generateAbsenceAlerts,
  generateFeeReminders,
} from "../communication/communication.service";
import { enqueueDueScheduledBackups, runScheduledBackup } from "../backups/backups.service";
import { enqueueDueScheduledExports, runScheduledExport } from "../exports/exports.service";
import { evaluateAlertRules } from "../observability/alerts.service";
import { runWebhookDeliveryJob } from "../integrations/webhooks.delivery";
import { sweepSubscriptionLifecycle } from "../billing/billing.service";
import { runRecurringBilling } from "../saaspayments/recurring.service";
import { runSchedulerTick } from "./jobs.service";

interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  institutionId: string | null;
  createdBy: string | null;
  /** The worker id that holds the claim (from the claim's RETURNING locked_by). */
  workerId: string | null;
}

type Handler = (job: ClaimedJob) => Promise<void>;

/** Job-type → handler. Each handler reuses an already-tested module service, so
 *  the worker stays a thin, tenant-aware dispatcher. Unknown types fail the job. */
const HANDLERS: Record<string, Handler> = {
  // Lightweight health/no-op job (useful for worker liveness checks).
  noop: async () => {},

  scheduled_report_run: async (job) => {
    const scheduleId = (job.payload as { scheduleId?: string }).scheduleId;
    if (!scheduleId || !job.institutionId) {
      throw new Error("scheduled_report_run requires scheduleId and institution");
    }
    await executeScheduledById(scheduleId, job.institutionId);
  },

  fee_reminder_sweep: async (job) => {
    if (!job.institutionId || !job.createdBy) {
      throw new Error("fee_reminder_sweep requires institution and creator");
    }
    await generateFeeReminders(job.institutionId, job.createdBy, {});
  },

  absence_alert_sweep: async (job) => {
    if (!job.institutionId || !job.createdBy) {
      throw new Error("absence_alert_sweep requires institution and creator");
    }
    const date =
      (job.payload as { date?: string }).date ?? new Date().toISOString().slice(0, 10);
    await generateAbsenceAlerts(job.institutionId, job.createdBy, date, false);
  },

  // Automated platform-wide database backup (enqueued by the schedule tick).
  scheduled_backup: async () => {
    await runScheduledBackup();
  },

  // Automated governed data export (enqueued by the export schedule tick).
  scheduled_export: async (job) => {
    await runScheduledExport(job.payload);
  },

  // Deliver one queued webhook event (HMAC-signed); throws on non-2xx so the
  // queue retries it with backoff.
  webhook_deliver: async (job) => {
    await runWebhookDeliveryJob(job.payload, job.institutionId, job.attempts);
  },

  // Evaluate observability alert rules against live metrics (Super Admin L).
  // Idempotent within each rule's cooldown, so a repeated tick is safe.
  alert_evaluation: async () => {
    await evaluateAlertRules();
  },
};

export const BACKOFF_BASE_MS = 30_000;

/** Exponential backoff: 30s, 60s, 120s, … keyed off the attempt just made. */
function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

/**
 * Atomically claim one due job. `FOR UPDATE SKIP LOCKED` guarantees no two
 * workers ever take the same job (no double processing). Optionally scoped to a
 * single institution. Increments attempts as part of the claim.
 */
export async function claimJob(
  workerId: string,
  scope: string | null
): Promise<ClaimedJob | null> {
  const params: unknown[] = [workerId];
  let sc = "";
  if (scope !== null) {
    params.push(scope);
    sc = ` AND institution_id = $${params.length}`;
  }
  const { rows } = await query<ClaimedJob>(
    `UPDATE jobs SET status='running', locked_at=now(), locked_by=$1,
       started_at=now(), attempts=attempts+1, updated_at=now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status='pending' AND run_at <= now()${sc}
       ORDER BY priority DESC, run_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, type, payload, attempts, max_attempts AS "maxAttempts",
               institution_id AS "institutionId", created_by AS "createdBy",
               locked_by AS "workerId"`,
    params
  );
  return rows[0] ?? null;
}

/**
 * Append one row to the per-attempt history (Super Admin M). Best-effort and
 * append-only: a recording failure is logged and swallowed so it can NEVER break
 * job processing. `error` / `result_summary` are already masked + short by the
 * caller (no stack, no secrets, no payload contents).
 */
async function recordAttempt(
  job: Pick<ClaimedJob, "id" | "attempts" | "workerId">,
  opts: {
    status: "success" | "retry" | "failed" | "dead_letter";
    startedMs: number;
    error?: string | null;
    retryReason?: string | null;
    backoffMs?: number | null;
    nextRetryAt?: Date | null;
    resultSummary?: string | null;
  }
): Promise<void> {
  try {
    await query(
      `INSERT INTO job_attempts
         (job_id, attempt_number, status, worker_id, started_at, finished_at,
          duration_ms, error, retry_reason, backoff_ms, next_retry_at, result_summary)
       VALUES ($1,$2,$3,$4, to_timestamp($5 / 1000.0), now(), $6,$7,$8,$9,$10,$11)`,
      [
        job.id,
        job.attempts,
        opts.status,
        job.workerId ?? null,
        opts.startedMs,
        Math.max(0, Date.now() - opts.startedMs),
        opts.error ?? null,
        opts.retryReason ?? null,
        opts.backoffMs ?? null,
        opts.nextRetryAt ?? null,
        opts.resultSummary ?? null,
      ]
    );
  } catch (err) {
    // Attempt history is observability only — never let it break processing.
    console.error("job attempt recording failed (continuing):", err);
  }
}

/**
 * Upsert this worker's heartbeat (Super Admin M). Keyed by worker_id; bumps the
 * processed/failed counters, tracks the current job, and records only SAFE host
 * facts (os.hostname + optional APP_VERSION — never private-network detail or a
 * secret). Best-effort: a heartbeat failure never breaks processing.
 */
async function upsertHeartbeat(
  workerId: string,
  opts: { currentJobId?: string | null; incProcessed?: number; incFailed?: number } = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO worker_heartbeats
         (worker_id, status, last_heartbeat_at, current_job_id, jobs_processed, jobs_failed, hostname, version)
       VALUES ($1, 'online', now(), $2, $3, $4, $5, $6)
       ON CONFLICT (worker_id) DO UPDATE SET
         status = 'online',
         last_heartbeat_at = now(),
         current_job_id = EXCLUDED.current_job_id,
         jobs_processed = worker_heartbeats.jobs_processed + $3,
         jobs_failed = worker_heartbeats.jobs_failed + $4,
         hostname = EXCLUDED.hostname,
         version = EXCLUDED.version`,
      [
        workerId,
        opts.currentJobId ?? null,
        opts.incProcessed ?? 0,
        opts.incFailed ?? 0,
        os.hostname().slice(0, 200),
        process.env.APP_VERSION ?? null,
      ]
    );
  } catch (err) {
    console.error("worker heartbeat failed (continuing):", err);
  }
}

/** Runs a claimed job; on error retries with backoff until max_attempts, then
 *  marks a permanent failure. Only a short error message is stored (no stack,
 *  no secrets). */
export async function runJob(job: ClaimedJob): Promise<"success" | "retry" | "failed"> {
  const startedMs = Date.now();
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Unknown job type: ${job.type}`);
    await handler(job);
    await query("UPDATE jobs SET status='success', completed_at=now(), error=NULL WHERE id=$1", [
      job.id,
    ]);
    recordJob("success");
    // Append-only attempt row. result_summary is a fixed SAFE token — never payload.
    await recordAttempt(job, { status: "success", startedMs, resultSummary: "ok" });
    return "success";
  } catch (err) {
    // Short + MASKED error only (no stack, no secrets); the same string is stored
    // on the job row and in the attempt history.
    const safe = String(maskFreeText((err instanceof Error ? err.message : "Job failed").slice(0, 500)));
    if (job.attempts >= job.maxAttempts) {
      await query(
        "UPDATE jobs SET status='failed', completed_at=now(), error=$2 WHERE id=$1",
        [job.id, safe]
      );
      recordJob("failed");
      await recordAttempt(job, { status: "failed", startedMs, error: safe, retryReason: "max_attempts_exhausted" });
      return "failed";
    }
    const backoff = backoffMs(job.attempts);
    const nextRetryAt = new Date(Date.now() + backoff);
    await query(
      `UPDATE jobs SET status='pending', run_at=$2, error=$3, locked_at=NULL, locked_by=NULL
       WHERE id=$1`,
      [job.id, nextRetryAt, safe]
    );
    recordJob("retry");
    await recordAttempt(job, {
      status: "retry",
      startedMs,
      error: safe,
      retryReason: "handler_error",
      backoffMs: backoff,
      nextRetryAt,
    });
    return "retry";
  }
}

/** Claims and runs up to `limit` due jobs (the worker loop body). Safe to call
 *  on demand (endpoint) or on a timer; needs only Postgres. */
export async function processDueJobs(
  opts: { limit?: number; scope?: string | null; workerId?: string } = {}
): Promise<{ processed: number; success: number; failed: number; retried: number }> {
  const limit = opts.limit ?? 25;
  const scope = opts.scope ?? null;
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  let processed = 0;
  let success = 0;
  let failed = 0;
  let retried = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimJob(workerId, scope);
    if (!job) break;
    // Heartbeat: mark this worker busy on the claimed job.
    await upsertHeartbeat(workerId, { currentJobId: job.id });
    const result = await runJob(job);
    processed += 1;
    if (result === "success") success += 1;
    else if (result === "failed") failed += 1;
    else retried += 1;
    // Heartbeat: clear current job + bump this run's counters.
    await upsertHeartbeat(workerId, {
      currentJobId: null,
      incProcessed: 1,
      incFailed: result === "failed" ? 1 : 0,
    });
  }
  // A liveness heartbeat even on an empty drain, so the worker is visible as
  // online in the console after any on-demand run.
  if (processed === 0) await upsertHeartbeat(workerId, { currentJobId: null });
  return { processed, success, failed, retried };
}

/**
 * Move a permanently `failed` job to the dead-letter queue (Super Admin M). State
 * rule enforced in-DB (only `failed` → `dead_letter`); the reason is masked +
 * short (no secrets). Append-only: writes a `dead_letter` attempt row. The audit
 * entry is written by the service layer, not here.
 */
export async function moveToDeadLetter(id: string, reason: string, _actor?: unknown): Promise<void> {
  const safeReason = String(maskFreeText((reason ?? "").slice(0, 500)));
  const { rows } = await query<{ attempts: number; workerId: string | null }>(
    `UPDATE jobs SET status='dead_letter', dead_lettered_at=now(),
       dead_letter_reason=$2, updated_at=now()
     WHERE id=$1 AND status='failed'
     RETURNING attempts, locked_by AS "workerId"`,
    [id, safeReason]
  );
  if (!rows[0]) throw ApiError.badRequest("Only failed jobs can be moved to the dead-letter queue");
  await recordAttempt(
    { id, attempts: rows[0].attempts, workerId: rows[0].workerId },
    { status: "dead_letter", startedMs: Date.now(), error: safeReason, retryReason: "dead_letter" }
  );
}

/**
 * Requeue a `dead_letter` job for a fresh run (Super Admin M). Only a
 * `dead_letter` job is eligible; resets attempts and clears the lock/error so the
 * claim path picks it up. The audit entry is written by the service layer.
 */
export async function requeueFromDeadLetter(id: string, _actor?: unknown): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `UPDATE jobs SET status='pending', attempts=0, run_at=now(), error=NULL,
       locked_at=NULL, locked_by=NULL, started_at=NULL, completed_at=NULL,
       dead_lettered_at=NULL, dead_letter_reason=NULL, updated_at=now()
     WHERE id=$1 AND status='dead_letter'
     RETURNING id`,
    [id]
  );
  if (!rows[0]) throw ApiError.badRequest("Only dead-letter jobs can be requeued");
}

let timer: NodeJS.Timeout | null = null;

/** Optional in-process background worker for self-hosted deployments. Disabled by
 *  default and never started under tests. On each tick it enqueues due scheduled
 *  reports (platform-wide) then drains the queue. */
export function startWorker(): void {
  if (timer || !env.jobWorkerEnabled || env.nodeEnv === "test") return;
  timer = setInterval(() => {
    void (async () => {
      try {
        await runSchedulerTick(null);
        await enqueueDueScheduledBackups();
        await enqueueDueScheduledExports();
        // Observability alert evaluation (L) — cheap + cooldown-idempotent.
        await evaluateAlertRules();
        await sweepSubscriptionLifecycle();
        // Online recurring billing + dunning (B4). A clean no-op unless the
        // operator enabled auto-charge AND the gateway is configured.
        await runRecurringBilling();
        await processDueJobs({ limit: 50 });
      } catch (err) {
        console.error("job worker tick failed:", err);
      }
    })();
  }, env.jobWorkerIntervalMs);
  timer.unref?.();
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
