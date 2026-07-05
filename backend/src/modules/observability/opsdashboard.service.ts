import os from "node:os";
import type { z } from "zod";
import { query } from "../../db/postgres";
import { getMongoDb } from "../../db/mongo";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { snapshot, perRouteSnapshot, topSlowRoutes } from "../../observability/metrics";
import { storage, storageMode, storageConfigured } from "../../utils/storage";
import { verifyMailer, mailerConfigured, sendTestEmail } from "../../utils/mailer";
import { maskFreeText } from "../platform/audit.service";
import { getGatewaySettings } from "../saaspayments/saaspayments.service";
import { securityAlerts } from "../platform/security.service";
import * as backups from "../backups/backups.service";
import * as exportsService from "../exports/exports.service";
import { evaluateAlertRules } from "./alerts.service";
import { recordAudit, type Actor } from "./audit";
import type { logExportQuerySchema, logsQuerySchema, uptimeQuerySchema } from "./observability.schema";

/**
 * Composed Health / Observability views (Super Admin L).
 *
 * Every health check is SAFE (status + a short, secret-free detail — never a
 * connection string, key, credential or raw storage path) and NON-throwing (a
 * failing dependency yields 'down'/'degraded', never a 500). Signals that cannot
 * be measured safely in-process (disk) are reported 'unknown', never faked.
 */

type ServiceStatus = "healthy" | "degraded" | "down" | "unknown";

interface HealthCheck {
  service: string;
  status: ServiceStatus;
  responseTimeMs: number | null;
  detail: string;
}

const safeErr = (err: unknown): string =>
  (err instanceof Error ? err.message : "unavailable").slice(0, 120);

const mb = (bytes: number): number => Math.round(bytes / 1_048_576);

/** Time a probe; any throw becomes a safe 'down' (never propagates). */
async function probe(
  service: string,
  fn: () => Promise<{ status: ServiceStatus; detail: string }>
): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const r = await fn();
    return { service, status: r.status, responseTimeMs: Date.now() - start, detail: r.detail };
  } catch (err) {
    return { service, status: "down", responseTimeMs: Date.now() - start, detail: safeErr(err) };
  }
}

async function jobSignals() {
  try {
    const { rows } = await query<{ pending: number; running: number; failed: number; stuck: number }>(
      `SELECT
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE status='running')::int AS running,
         count(*) FILTER (WHERE status='failed')::int AS failed,
         count(*) FILTER (WHERE status='running' AND locked_at < now() - interval '10 minutes')::int AS stuck
       FROM jobs`
    );
    return rows[0];
  } catch {
    return { pending: 0, running: 0, failed: 0, stuck: 0 };
  }
}

/** Probe every dependency and PERSIST each result to service_health_history. */
export async function runHealthChecks(): Promise<HealthCheck[]> {
  const jobs = await jobSignals();

  const database = await probe("database", async () => {
    await query("SELECT 1");
    return { status: "healthy", detail: "PostgreSQL reachable" };
  });

  const api: HealthCheck = {
    service: "api",
    status: "healthy",
    responseTimeMs: 0,
    detail: `API process up (${Math.round(process.uptime())}s)`,
  };

  // The frontend is a separate deployment; the backend can't safely probe it.
  const frontend: HealthCheck = {
    service: "frontend",
    status: "unknown",
    responseTimeMs: null,
    detail: "Served separately (Next.js) — not probed from the API",
  };

  const mongo = await probe("mongo", async () =>
    getMongoDb() !== null
      ? { status: "healthy", detail: "MongoDB connected" }
      : { status: "unknown", detail: "MongoDB not configured (optional)" }
  );

  const storageCheck = await probe("storage", async () => {
    if (!storageConfigured() && storageMode !== "local") {
      return { status: "unknown", detail: "Object storage not configured" };
    }
    // Status only — the raw ping detail carries the local disk PATH / the S3
    // bucket+host, which must never surface in the observability dashboard or be
    // persisted to service_health_history. Derive a safe, path-free detail.
    const p = await storage.ping();
    const safeDetail = p.ok
      ? storageMode === "s3"
        ? "Object storage reachable"
        : "Local disk writable"
      : "Storage unreachable";
    return { status: p.ok ? "healthy" : "down", detail: safeDetail };
  });

  const smtp = await probe("smtp", async () => {
    if (!mailerConfigured()) return { status: "unknown", detail: "SMTP not configured (optional)" };
    const v = await verifyMailer();
    // Never surface v.error — it can carry host/credential detail.
    return { status: v.ok ? "healthy" : "degraded", detail: v.ok ? "SMTP reachable" : "SMTP verification failed" };
  });

  const gateway = await probe("gateway", async () => {
    const g = await getGatewaySettings();
    if (!g.enabled) return { status: "unknown", detail: "Payment gateway disabled" };
    return {
      status: g.configured ? "healthy" : "degraded",
      detail: g.configured ? "Gateway configured" : "Gateway enabled but not fully configured",
    };
  });

  const worker: HealthCheck = {
    service: "worker",
    status: env.jobWorkerEnabled ? (jobs.stuck > 0 ? "degraded" : "healthy") : "unknown",
    responseTimeMs: null,
    detail: env.jobWorkerEnabled
      ? `${jobs.running} running, ${jobs.stuck} stuck`
      : "Worker runs on-demand (no resident process)",
  };

  const scheduler: HealthCheck = {
    service: "scheduler",
    status: env.jobWorkerEnabled ? (jobs.stuck > 0 ? "degraded" : "healthy") : "unknown",
    responseTimeMs: null,
    detail: env.jobWorkerEnabled ? "Scheduler tick active" : "Scheduler runs on-demand",
  };

  const queue: HealthCheck = {
    service: "queue",
    status: jobs.pending > 1000 ? "degraded" : "healthy",
    responseTimeMs: null,
    detail: `${jobs.pending} pending, ${jobs.running} running`,
  };

  const mem = process.memoryUsage();
  const memPct = mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;
  const memory: HealthCheck = {
    service: "memory",
    status: memPct >= 90 ? "degraded" : "healthy",
    responseTimeMs: null,
    detail: `Heap ${memPct}% (${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB)`,
  };

  // Disk is not safely available in-process — honestly reported as unknown.
  const disk: HealthCheck = {
    service: "disk",
    status: "unknown",
    responseTimeMs: null,
    detail: "Disk usage not tracked in-process",
  };

  const load = os.loadavg();
  const cores = os.cpus()?.length || 1;
  const loadZero = load[0] === 0 && load[1] === 0 && load[2] === 0;
  const cpu: HealthCheck = {
    service: "cpu",
    status: loadZero ? "unknown" : load[0] >= cores * 1.5 ? "degraded" : "healthy",
    responseTimeMs: null,
    detail: loadZero ? "CPU load not available" : `Load ${load[0].toFixed(2)} / ${cores} cores`,
  };

  const checks = [
    api,
    frontend,
    database,
    mongo,
    worker,
    scheduler,
    queue,
    storageCheck,
    smtp,
    gateway,
    memory,
    disk,
    cpu,
  ];

  await persistHealth(checks);
  return checks;
}

/** Append every check to the uptime history (append-only). Best-effort. */
async function persistHealth(checks: HealthCheck[]): Promise<void> {
  if (checks.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  for (const c of checks) {
    const base = params.length;
    values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
    params.push(c.service, c.status, c.responseTimeMs, c.detail.slice(0, 300));
  }
  await query(
    `INSERT INTO service_health_history (service, status, response_time_ms, detail) VALUES ${values.join(",")}`,
    params
  );
}

function overallStatus(checks: HealthCheck[]): { status: ServiceStatus; healthy: number; degraded: number; down: number; unknown: number } {
  let healthy = 0;
  let degraded = 0;
  let down = 0;
  let unknown = 0;
  for (const c of checks) {
    if (c.status === "healthy") healthy += 1;
    else if (c.status === "degraded") degraded += 1;
    else if (c.status === "down") down += 1;
    else unknown += 1;
  }
  const status: ServiceStatus = down > 0 ? "down" : degraded > 0 ? "degraded" : "healthy";
  return { status, healthy, degraded, down, unknown };
}

// ============================ Dashboard ====================================

export async function healthDashboard() {
  // Opportunistic evaluation so alerting works without a resident worker
  // (cooldown makes it idempotent). Never allowed to break the dashboard.
  await evaluateAlertRules().catch(() => undefined);

  const checks = await runHealthChecks();
  const overall = overallStatus(checks);
  const snap = snapshot();

  const jobs = await jobSignals();
  const failedToday = Number(
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jobs WHERE status='failed' AND completed_at >= date_trunc('day', now())`
      )
    ).rows[0].n
  );

  const incidents = (
    await query<{ active: number; critical: number }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('open','investigating','monitoring'))::int AS active,
         count(*) FILTER (WHERE severity='critical' AND status IN ('open','investigating','monitoring'))::int AS critical
       FROM incidents`
    )
  ).rows[0];

  const recentAlerts = (
    await query(
      `SELECT id, rule_name AS "ruleName", type, severity, status, service, triggered_at AS "triggeredAt"
       FROM alerts ORDER BY triggered_at DESC LIMIT 10`
    )
  ).rows;
  const openAlerts = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM alerts WHERE status='triggered'`)).rows[0].n
  );

  const uptime = (
    await query<{ total: number; healthy: number; since: Date | null }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='healthy')::int AS healthy,
              min(checked_at) AS since
       FROM service_health_history WHERE checked_at >= now() - interval '7 days'`
    )
  ).rows[0];

  const backupCard = (
    await query<{ lastSuccessAt: Date | null; failed: number; storageUsedBytes: string | null }>(
      `SELECT max(completed_at) FILTER (WHERE status='success') AS "lastSuccessAt",
              count(*) FILTER (WHERE status='failed')::int AS failed,
              coalesce(sum(size_bytes) FILTER (WHERE status='success'),0)::text AS "storageUsedBytes"
       FROM backups`
    )
  ).rows[0];

  const errRatePct = snap.requestsTotal ? Math.round((snap.errorsTotal / snap.requestsTotal) * 10000) / 100 : 0;
  const avgMs = snap.durationCount ? Math.round(snap.durationSumMs / snap.durationCount) : 0;

  return {
    overall,
    services: checks,
    metrics: {
      requestsTotal: snap.requestsTotal,
      errorsTotal: snap.errorsTotal,
      apiErrorRatePct: errRatePct,
      avgResponseMs: avgMs,
      byStatusClass: snap.byStatusClass,
      queueDepth: jobs.pending + jobs.running,
      pendingJobs: jobs.pending,
      runningJobs: jobs.running,
      failedJobsToday: failedToday,
      stuckJobs: jobs.stuck,
    },
    incidents: { active: Number(incidents.active), critical: Number(incidents.critical) },
    alerts: { open: openAlerts, recent: recentAlerts },
    uptime: {
      windowChecks: Number(uptime.total),
      healthyChecks: Number(uptime.healthy),
      since: uptime.since,
      note: "Uptime history starts from this deployment (in-process sweep).",
    },
    backupStorage: {
      lastSuccessAt: backupCard.lastSuccessAt,
      failed: Number(backupCard.failed),
      storageUsedBytes: Number(backupCard.storageUsedBytes ?? 0),
    },
    deploy: { lastDeployAt: null, note: "Deployment timestamp not tracked" },
  };
}

/** GET /services — run the checks (persists to history) + overall. */
export async function serviceHealthList() {
  const checks = await runHealthChecks();
  return { overall: overallStatus(checks), services: checks };
}

/** POST /services/run — explicit run (audited). */
export async function runServiceChecks(actor: Actor) {
  const checks = await runHealthChecks();
  await recordAudit(actor, {
    action: "observability.health_checked",
    targetType: "observability",
    targetId: null,
    detail: { services: checks.length, ...overallStatus(checks) },
  });
  return { overall: overallStatus(checks), services: checks };
}

export async function serviceHealthDetail(name: string) {
  const checks = await runHealthChecks();
  const current = checks.find((c) => c.service === name);
  if (!current) throw ApiError.notFound("Unknown service");
  const { rows: history } = await query(
    `SELECT status, response_time_ms AS "responseTimeMs", detail, checked_at AS "checkedAt"
     FROM service_health_history WHERE service = $1
     ORDER BY checked_at DESC LIMIT 100`,
    [name]
  );
  const agg = (
    await query<{ total: number; healthy: number; degraded: number; down: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='healthy')::int AS healthy,
              count(*) FILTER (WHERE status='degraded')::int AS degraded,
              count(*) FILTER (WHERE status='down')::int AS down
       FROM service_health_history WHERE service = $1 AND checked_at >= now() - interval '7 days'`,
      [name]
    )
  ).rows[0];
  const measured = Number(agg.total);
  return {
    service: name,
    current,
    uptimePct: measured > 0 ? Math.round((Number(agg.healthy) / measured) * 10000) / 100 : null,
    counts: { total: measured, healthy: Number(agg.healthy), degraded: Number(agg.degraded), down: Number(agg.down) },
    history,
  };
}

// ============================ Uptime =======================================

export async function uptimeHistory(q: z.infer<typeof uptimeQuerySchema>) {
  const interval = q.window === "24h" ? "24 hours" : q.window === "30d" ? "30 days" : "7 days";
  const params: unknown[] = [];
  let serviceClause = "";
  if (q.service) {
    params.push(q.service);
    serviceClause = ` AND service = $${params.length}`;
  }
  const { rows } = await query<Record<string, number | string | Date | null>>(
    `SELECT service,
            count(*)::int AS total,
            count(*) FILTER (WHERE status='healthy')::int AS healthy,
            count(*) FILTER (WHERE status='degraded')::int AS degraded,
            count(*) FILTER (WHERE status='down')::int AS down,
            count(*) FILTER (WHERE status='unknown')::int AS unknown,
            round(avg(response_time_ms) FILTER (WHERE response_time_ms IS NOT NULL))::int AS "avgResponseMs",
            max(checked_at) AS "lastCheckedAt"
     FROM service_health_history
     WHERE checked_at >= now() - interval '${interval}'${serviceClause}
     GROUP BY service ORDER BY service`,
    params
  );

  const services = rows.map((r) => {
    const total = Number(r.total);
    const measured = total - Number(r.unknown);
    const healthy = Number(r.healthy);
    return {
      service: r.service,
      total,
      healthy,
      degraded: Number(r.degraded),
      down: Number(r.down),
      unknown: Number(r.unknown),
      avgResponseMs: r.avgResponseMs ?? null,
      lastCheckedAt: r.lastCheckedAt,
      uptimePct: measured > 0 ? Math.round((healthy / measured) * 10000) / 100 : null,
    };
  });

  // Recent degraded/down periods for visibility.
  const { rows: incidentsWindow } = await query(
    `SELECT service, status, detail, checked_at AS "checkedAt"
     FROM service_health_history
     WHERE status IN ('degraded','down') AND checked_at >= now() - interval '${interval}'${serviceClause}
     ORDER BY checked_at DESC LIMIT 50`,
    params
  );

  const totalRows = services.reduce((s, x) => s + x.total, 0);
  return {
    window: q.window,
    services,
    degradedPeriods: incidentsWindow,
    sparse: totalRows < 5,
    note:
      totalRows < 5
        ? "History is sparse — it starts from this deployment and fills as health checks run."
        : "Uptime is computed from persisted health-check sweeps since this deployment.",
  };
}

// ============================ Performance ==================================

export function performance() {
  const snap = snapshot();
  const errRatePct = snap.requestsTotal ? Math.round((snap.errorsTotal / snap.requestsTotal) * 10000) / 100 : 0;
  const avgMs = snap.durationCount ? Math.round(snap.durationSumMs / snap.durationCount) : 0;
  return {
    requests: {
      total: snap.requestsTotal,
      errors: snap.errorsTotal,
      errorRatePct: errRatePct,
      avgResponseMs: avgMs,
      byStatusClass: snap.byStatusClass,
    },
    perRoute: perRouteSnapshot(),
    slowRoutes: topSlowRoutes(10),
    note: "Latency metrics are in-process and reset on restart (since deployment).",
  };
}

// ============================ Storage ======================================

export async function storageDashboard() {
  const totals = (
    await query<{ backups: string; exports: string; documents: string; docCount: number }>(
      `SELECT
         (SELECT coalesce(sum(size_bytes) FILTER (WHERE status='success'),0)::text FROM backups) AS backups,
         (SELECT coalesce(sum(size_bytes) FILTER (WHERE status='completed'),0)::text FROM platform_exports) AS exports,
         (SELECT coalesce(sum(size_bytes),0)::text FROM documents) AS documents,
         (SELECT count(*)::int FROM documents) AS "docCount"`
    )
  ).rows[0];

  const byCategory = (
    await query(
      `SELECT category, coalesce(sum(size_bytes),0)::text AS "bytes", count(*)::int AS count
       FROM documents GROUP BY category ORDER BY sum(size_bytes) DESC NULLS LAST`
    )
  ).rows.map((r) => ({ category: r.category, bytes: Number(r.bytes), count: Number(r.count) }));

  // Per-tenant document usage vs the plan storage limit (settings.limits.storageLimitMb).
  const tenants = (
    await query<{
      institutionId: string;
      institutionName: string;
      institutionCode: string;
      usedBytes: string;
      documents: number;
      limitMb: string | null;
    }>(
      `SELECT d.institution_id AS "institutionId", i.name AS "institutionName", i.code AS "institutionCode",
              coalesce(sum(d.size_bytes),0)::text AS "usedBytes", count(*)::int AS documents,
              (i.settings->'limits'->>'storageLimitMb') AS "limitMb"
       FROM documents d JOIN institutions i ON i.id = d.institution_id
       GROUP BY d.institution_id, i.name, i.code, i.settings->'limits'->>'storageLimitMb'
       ORDER BY sum(d.size_bytes) DESC NULLS LAST LIMIT 100`
    )
  ).rows.map((r) => {
    const usedBytes = Number(r.usedBytes);
    const usedMb = Math.round((usedBytes / 1_048_576) * 100) / 100;
    const limitMb = r.limitMb == null || r.limitMb === "" ? null : Number(r.limitMb);
    const pct = limitMb && limitMb > 0 ? Math.round((usedMb / limitMb) * 10000) / 100 : null;
    return {
      institutionId: r.institutionId,
      institutionName: r.institutionName,
      institutionCode: r.institutionCode,
      documents: Number(r.documents),
      usedBytes,
      usedMb,
      limitMb,
      usagePct: pct,
      nearLimit: pct != null && pct >= 80 && pct < 100,
      overLimit: pct != null && pct >= 100,
    };
  });

  const totalBytes = Number(totals.backups) + Number(totals.exports) + Number(totals.documents);
  return {
    totalBytes,
    byCategory: {
      backups: Number(totals.backups),
      exports: Number(totals.exports),
      documents: Number(totals.documents),
    },
    documentCategories: byCategory,
    documentCount: Number(totals.docCount),
    storageMode,
    byTenant: tenants,
    nearOrOverLimit: tenants.filter((t) => t.nearLimit || t.overLimit),
    largestTenants: tenants.slice(0, 10),
  };
}

// ============================ SMTP =========================================

/** Mask an email's local-part (a***@domain) — never expose the full address. */
function maskEmail(email: string | null): string {
  if (!email) return "(unknown)";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export async function smtpHealth() {
  const configured = mailerConfigured();
  const verify = configured ? await verifyMailer() : { configured: false, ok: false };

  const counts = (
    await query<{ sent: number; failed: number; skipped: number }>(
      `SELECT
         count(*) FILTER (WHERE status='sent')::int AS sent,
         count(*) FILTER (WHERE status='failed')::int AS failed,
         count(*) FILTER (WHERE status='skipped')::int AS skipped
       FROM invoice_emails WHERE created_at >= now() - interval '30 days'`
    )
  ).rows[0];

  const recentFailed = (
    await query<{ recipient: string; template: string; createdAt: Date }>(
      `SELECT recipient, template, created_at AS "createdAt"
       FROM invoice_emails WHERE status='failed'
       ORDER BY created_at DESC LIMIT 10`
    )
  ).rows.map((r) => ({ recipient: maskEmail(r.recipient), template: r.template, createdAt: r.createdAt }));

  const sent = Number(counts.sent);
  const failed = Number(counts.failed);
  const attempts = sent + failed;
  return {
    // Status only — never verify.error (may carry host/credential detail).
    configured,
    status: !configured ? "unknown" : verify.ok ? "healthy" : "degraded",
    verified: Boolean(verify.ok),
    delivery: {
      sent,
      failed,
      skipped: Number(counts.skipped),
      failureRatePct: attempts > 0 ? Math.round((failed / attempts) * 10000) / 100 : 0,
    },
    recentFailedRecipients: recentFailed,
    note: "Delivery signal is derived from transactional invoice email outcomes.",
  };
}

export async function sendSmtpTest(to: string, actor: Actor) {
  const result = await sendTestEmail(to);
  await recordAudit(actor, {
    action: "observability.smtp_test",
    targetType: "observability",
    targetId: null,
    detail: { to: maskEmail(to), ok: result.ok },
  });
  // Never return result.error (can carry host/credentials) — status only.
  return { ok: result.ok, recipient: maskEmail(to) };
}

// ============================ Jobs health (link only) ======================

export async function jobsHealth() {
  const byStatus = (
    await query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM jobs GROUP BY status`)
  ).rows;
  const map = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));

  const stuck = Number(
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jobs WHERE status='running' AND locked_at < now() - interval '10 minutes'`
      )
    ).rows[0].n
  );

  const failedTrend = (
    await query(
      `SELECT to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
       FROM jobs WHERE status='failed' AND completed_at >= now() - interval '7 days'
       GROUP BY 1 ORDER BY 1`
    )
  ).rows;

  const snap = snapshot();
  return {
    queue: {
      pending: map.pending ?? 0,
      running: map.running ?? 0,
      success: map.success ?? 0,
      failed: map.failed ?? 0,
      cancelled: map.cancelled ?? 0,
    },
    stuck,
    failedTrend,
    processed: { success: snap.jobsSuccess, failed: snap.jobsFailed, retried: snap.jobsRetried },
    workerEnabled: env.jobWorkerEnabled,
    link: "/jobs",
  };
}

// ============================ Integrations =================================

export async function integrations() {
  const [backupSum, exportSum, alerts, auditRow] = await Promise.all([
    backups.summary().catch(() => null),
    exportsService.summary().catch(() => null),
    securityAlerts().catch(() => []),
    query<{ last24h: number; highRisk24h: number }>(
      `SELECT count(*)::int AS last24h,
              count(*) FILTER (WHERE action ~ '^(rbac|impersonate|backup|restore|security|export|incident|alert)\\.')::int AS "highRisk24h"
       FROM platform_audit_log WHERE created_at >= now() - interval '24 hours'`
    ).then((r) => r.rows[0]).catch(() => ({ last24h: 0, highRisk24h: 0 })),
  ]);

  const b = backupSum as Record<string, unknown> | null;
  const e = exportSum as Record<string, unknown> | null;
  const bTotals = (b?.totals ?? {}) as Record<string, unknown>;
  const eTotals = (e?.totals ?? {}) as Record<string, unknown>;

  return {
    backups: b
      ? {
          lastSuccessAt: b.lastSuccessAt ?? null,
          available: Number(bTotals.available ?? 0),
          failed: Number(bTotals.failed ?? 0),
          storageUsedBytes: Number(b.storageUsedBytes ?? 0),
          warnings: Array.isArray(b.warnings) ? b.warnings.length : 0,
        }
      : { unavailable: true },
    exports: e
      ? {
          total: Number(eTotals.total ?? 0),
          pendingApproval: Number(e.pendingApproval ?? 0),
          sensitive: Number(e.sensitive ?? 0),
          storageUsedBytes: Number(e.storageUsedBytes ?? 0),
        }
      : { unavailable: true },
    security: {
      alerts: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
    },
    audit: { last24h: Number(auditRow.last24h), highRisk24h: Number(auditRow.highRisk24h) },
    links: {
      backups: "/backups",
      exports: "/exports",
      security: "/platform/security",
      audit: "/platform/audit",
    },
  };
}

// ============================ Logs =========================================

export async function logsSummary(q: z.infer<typeof logsQuerySchema>) {
  const wantErrors = q.source === "all" || q.source === "errors";
  const wantAudit = q.source === "all" || q.source === "audit";

  let errors: Record<string, unknown>[] = [];
  if (wantErrors) {
    const params: unknown[] = [];
    let filter = "";
    if (q.q) {
      params.push(`%${q.q}%`);
      filter = ` WHERE (message ILIKE $${params.length} OR route ILIKE $${params.length})`;
    }
    params.push(q.limit);
    errors = (
      await query<Record<string, unknown>>(
        `SELECT id, route, method, status_code AS "statusCode", error_type AS "errorType",
                message, status, count, last_seen AS "lastSeen"
         FROM error_events${filter} ORDER BY last_seen DESC LIMIT $${params.length}`,
        params
      )
    ).rows.map((r) => ({ ...r, message: r.message ? maskFreeText(r.message) : r.message }));
  }

  let audit: Record<string, unknown>[] = [];
  if (wantAudit) {
    const params: unknown[] = [];
    let filter = "";
    if (q.q) {
      params.push(`%${q.q}%`);
      filter = ` AND (action ILIKE $${params.length} OR actor_email ILIKE $${params.length})`;
    }
    params.push(q.limit);
    audit = (
      await query<Record<string, unknown>>(
        `SELECT id, action, actor_email AS "actorEmail", actor_role AS "actorRole",
                target_type AS "targetType", ip, created_at AS "createdAt"
         FROM platform_audit_log WHERE 1=1${filter}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      )
    ).rows;
  }

  return { source: q.source, errors, audit };
}

export const LOG_EXPORT_COLUMNS = [
  { key: "time", label: "Time" },
  { key: "source", label: "Source" },
  { key: "level", label: "Level" },
  { key: "ref", label: "Route / action" },
  { key: "message", label: "Message" },
];

/** Reason-gated broad log export rows (masked). */
export async function logExportRows(q: z.infer<typeof logExportQuerySchema>) {
  const out: Record<string, unknown>[] = [];
  if (q.source === "all" || q.source === "errors") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT to_char(last_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time,
              method || ' ' || route AS ref, status_code AS "statusCode", message
       FROM error_events ORDER BY last_seen DESC LIMIT 25000`
    );
    for (const r of rows) {
      out.push({
        time: r.time,
        source: "error",
        level: Number(r.statusCode) >= 500 ? "error" : "warn",
        ref: r.ref,
        message: r.message ? maskFreeText(r.message) : "",
      });
    }
  }
  if (q.source === "all" || q.source === "audit") {
    const { rows } = await query<Record<string, unknown>>(
      `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS time,
              action, actor_email AS "actorEmail"
       FROM platform_audit_log ORDER BY created_at DESC LIMIT 25000`
    );
    for (const r of rows) {
      out.push({
        time: r.time,
        source: "audit",
        level: "info",
        ref: r.action,
        message: r.actorEmail ?? "",
      });
    }
  }
  return out;
}
