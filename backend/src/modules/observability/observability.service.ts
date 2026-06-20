import { pool, query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { env } from "../../config/env";
import { snapshot } from "../../observability/metrics";
import { cacheStats } from "../../cache/cache";

async function groupCounts(sql: string): Promise<Record<string, number>> {
  const { rows } = await query<{ status: string; n: number }>(sql);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/**
 * Readiness probe — fails only on CRITICAL dependencies (DB + migrations).
 * Optional dependencies (job queue, storage, external providers) are reported
 * but never fail readiness. No secrets or tenant data are returned.
 */
export async function readiness() {
  const checks: Record<string, boolean | string> = {
    database: false,
    migrations: false,
    jobQueue: env.jobWorkerEnabled ? false : "disabled",
    storage: env.storageBucket ? true : "local",
  };
  try {
    await query("SELECT 1");
    checks.database = true;
    const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations");
    checks.migrations = rows[0].n > 0;
    if (env.jobWorkerEnabled) {
      await query("SELECT count(*) FROM jobs");
      checks.jobQueue = true;
    }
  } catch {
    // reported via the false flags below
  }
  const ready = checks.database === true && checks.migrations === true;
  return { ready, checks };
}

/** Liveness — always cheap; the process is up if this responds. */
export function liveness() {
  return { status: "ok", uptimeSeconds: Math.round(process.uptime()) };
}

/** Detailed health (super-admin) — DB/Mongo, migrations, queue depth, config. */
export async function detailedHealth() {
  let postgres = false;
  try {
    await pool.query("SELECT 1");
    postgres = true;
  } catch {
    postgres = false;
  }
  const migrations = postgres
    ? (await query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n
    : 0;
  const queue = postgres ? await groupCounts("SELECT status, count(*)::int AS n FROM jobs GROUP BY status") : {};
  return {
    status: postgres ? "ok" : "degraded",
    postgres,
    mongo: getMongoDb() !== null,
    migrations,
    queue,
    jobWorkerEnabled: env.jobWorkerEnabled,
    storageConfigured: Boolean(env.storageBucket),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** Platform observability overview (super-admin admin view). */
export async function overview() {
  const m = snapshot();
  const queue = await groupCounts("SELECT status, count(*)::int AS n FROM jobs GROUP BY status");
  const scheduled = await groupCounts(
    "SELECT status, count(*)::int AS n FROM scheduled_report_runs GROUP BY status"
  );
  const { rows: recentFailures } = await query(
    `SELECT id, type, error, institution_id AS "institutionId", completed_at AS "completedAt"
     FROM jobs WHERE status = 'failed' ORDER BY completed_at DESC NULLS LAST LIMIT 10`
  );
  return {
    requests: {
      total: m.requestsTotal,
      errors: m.errorsTotal,
      byStatusClass: m.byStatusClass,
      avgDurationMs: m.durationCount ? Math.round(m.durationSumMs / m.durationCount) : 0,
    },
    jobs: { success: m.jobsSuccess, failed: m.jobsFailed, retried: m.jobsRetried, queue },
    scheduledReports: scheduled,
    cache: cacheStats(),
    recentFailures,
    worker: { enabled: env.jobWorkerEnabled, intervalMs: env.jobWorkerIntervalMs },
  };
}

function line(parts: string[]): string {
  return parts.join("\n");
}

/** Prometheus text exposition. Counters are in-process; gauges are live from DB. */
export async function renderMetrics(): Promise<string> {
  const m = snapshot();
  const queue = await groupCounts("SELECT status, count(*)::int AS n FROM jobs GROUP BY status");
  const scheduled = await groupCounts(
    "SELECT status, count(*)::int AS n FROM scheduled_report_runs GROUP BY status"
  );
  const out: string[] = [];

  out.push("# HELP http_requests_total Total HTTP requests handled");
  out.push("# TYPE http_requests_total counter");
  out.push(`http_requests_total ${m.requestsTotal}`);
  for (const [cls, n] of Object.entries(m.byStatusClass)) {
    out.push(`http_requests_total{class="${cls}"} ${n}`);
  }

  out.push("# HELP http_request_errors_total HTTP responses with status >= 500");
  out.push("# TYPE http_request_errors_total counter");
  out.push(`http_request_errors_total ${m.errorsTotal}`);

  out.push("# HELP http_request_duration_ms Request duration summary");
  out.push("# TYPE http_request_duration_ms summary");
  out.push(`http_request_duration_ms_sum ${m.durationSumMs}`);
  out.push(`http_request_duration_ms_count ${m.durationCount}`);

  out.push("# HELP jobs_processed_total Jobs processed by result");
  out.push("# TYPE jobs_processed_total counter");
  out.push(`jobs_processed_total{result="success"} ${m.jobsSuccess}`);
  out.push(`jobs_processed_total{result="failed"} ${m.jobsFailed}`);
  out.push(`jobs_processed_total{result="retry"} ${m.jobsRetried}`);

  out.push("# HELP jobs_queue_depth Current jobs by status");
  out.push("# TYPE jobs_queue_depth gauge");
  for (const status of ["pending", "running", "success", "failed", "cancelled"]) {
    out.push(`jobs_queue_depth{status="${status}"} ${queue[status] ?? 0}`);
  }

  out.push("# HELP scheduled_report_runs_total Scheduled report runs by status");
  out.push("# TYPE scheduled_report_runs_total gauge");
  for (const [status, n] of Object.entries(scheduled)) {
    out.push(`scheduled_report_runs_total{status="${status}"} ${n}`);
  }

  const cache = cacheStats();
  out.push("# HELP cache_hits_total Hot-path cache reads served from cache");
  out.push("# TYPE cache_hits_total counter");
  out.push(`cache_hits_total ${cache.hits}`);
  out.push("# HELP cache_misses_total Hot-path cache reads that fell through to the loader");
  out.push("# TYPE cache_misses_total counter");
  out.push(`cache_misses_total ${cache.misses}`);
  out.push("# HELP cache_invalidations_total Cache entries dropped by explicit invalidation");
  out.push("# TYPE cache_invalidations_total counter");
  out.push(`cache_invalidations_total ${cache.invalidations}`);
  out.push("# HELP cache_entries Current number of live cache entries");
  out.push("# TYPE cache_entries gauge");
  out.push(`cache_entries ${cache.size}`);

  return line(out) + "\n";
}
