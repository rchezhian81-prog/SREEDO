import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { recordJob } from "../../observability/metrics";
import { executeScheduledById } from "../scheduledreports/scheduledreports.service";
import {
  generateAbsenceAlerts,
  generateFeeReminders,
} from "../communication/communication.service";
import { enqueueDueScheduledBackups, runScheduledBackup } from "../backups/backups.service";
import { enqueueDueScheduledExports, runScheduledExport } from "../exports/exports.service";
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
};

const BACKOFF_BASE_MS = 30_000;

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
               institution_id AS "institutionId", created_by AS "createdBy"`,
    params
  );
  return rows[0] ?? null;
}

/** Runs a claimed job; on error retries with backoff until max_attempts, then
 *  marks a permanent failure. Only a short error message is stored (no stack,
 *  no secrets). */
export async function runJob(job: ClaimedJob): Promise<"success" | "retry" | "failed"> {
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Unknown job type: ${job.type}`);
    await handler(job);
    await query("UPDATE jobs SET status='success', completed_at=now(), error=NULL WHERE id=$1", [
      job.id,
    ]);
    recordJob("success");
    return "success";
  } catch (err) {
    const safe = (err instanceof Error ? err.message : "Job failed").slice(0, 500);
    if (job.attempts >= job.maxAttempts) {
      await query(
        "UPDATE jobs SET status='failed', completed_at=now(), error=$2 WHERE id=$1",
        [job.id, safe]
      );
      recordJob("failed");
      return "failed";
    }
    await query(
      `UPDATE jobs SET status='pending', run_at=$2, error=$3, locked_at=NULL, locked_by=NULL
       WHERE id=$1`,
      [job.id, new Date(Date.now() + backoffMs(job.attempts)), safe]
    );
    recordJob("retry");
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
    const result = await runJob(job);
    processed += 1;
    if (result === "success") success += 1;
    else if (result === "failed") failed += 1;
    else retried += 1;
  }
  return { processed, success, failed, retried };
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
