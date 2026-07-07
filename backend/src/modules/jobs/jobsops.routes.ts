import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { uuidParam, param } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import * as service from "./jobsops.service";
import {
  summaryQuerySchema,
  listJobsQuerySchema,
  deadLetterQuerySchema,
  jobActionSchema,
  highRiskActionSchema,
  bulkSchema,
  scheduleActionSchema,
  alertListQuerySchema,
  alertNoteSchema,
  reportsQuerySchema,
  exportQuerySchema,
} from "./jobsops.schema";

/**
 * Super Admin M — Background Jobs Console / Queue Governance router.
 *
 * A NEW router mounted at /jobs-ops (the existing /jobs router is untouched).
 * Every route runs under `authenticate` + a per-route `requirePermission` using
 * the granular 0101 perms — RBAC is enforced SERVER-SIDE (the frontend is not
 * trusted). Reads use jobs:read or a specific *_read perm; mutations use the
 * specific action perm. Every mutating action is audited in the service layer.
 */
export const jobsOpsRouter = Router();
jobsOpsRouter.use(authenticate);
// Platform boundary: this is a super-admin surface. Tenant roles hold the base
// jobs:* keys from 0040 (so requirePermission alone would let a tenant admin read
// this console); this guard keeps the whole ops surface platform-only. Platform
// sub-roles (owner/technical_admin/auditor) all carry user_role='super_admin', so
// they pass here and are then narrowed by the per-route requirePermission below.
jobsOpsRouter.use(authorize("super_admin"));

const actor = (req: Request): service.Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Masked CSV/XLSX response for a curated column set (no secrets / stack). */
function sendSpreadsheet(
  res: Response,
  format: "csv" | "xlsx",
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): void {
  const headers = columns.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(toXlsx(headers, data));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(headers, data));
  }
}

const canRead = requirePermission("jobs:read");

/**
 * @openapi
 * /jobs-ops/summary:
 *   get: { tags: [JobsOps], summary: "Jobs console dashboard (~20 metric cards; status/queue/worker/scheduler/alerts). Masked, no secrets.", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: window, schema: { type: string, enum: [today, 24h, 7d, 30d, custom] } }], responses: { 200: { description: Dashboard } } }
 */
jobsOpsRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.dashboard(summaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs-ops/jobs:
 *   get: { tags: [JobsOps], summary: "Search + filter + paginate + sort jobs (payload MASKED). Filters: q, status(+stuck/dead_letter), type, queue, institutionId, workerId, module, attemptsMin, date ranges.", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
jobsOpsRouter.get("/jobs", canRead, async (req, res) => {
  res.json(await service.listJobs(listJobsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs-ops/dead-letter:
 *   get: { tags: [JobsOps], summary: "List dead-letter jobs (paginated; masked).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
jobsOpsRouter.get("/dead-letter", canRead, async (req, res) => {
  res.json(await service.deadLetterList(deadLetterQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs-ops/workers:
 *   get: { tags: [JobsOps], summary: "Worker heartbeats with derived online/degraded/offline status (on-demand worker).", security: [{ bearerAuth: [] }], responses: { 200: { description: Workers } } }
 */
jobsOpsRouter.get("/workers", requirePermission("jobs:workers_read"), async (_req, res) => {
  res.json(await service.workers());
});

/**
 * @openapi
 * /jobs-ops/schedules:
 *   get: { tags: [JobsOps], summary: "Aggregated recurring schedules (scheduled reports, automated backup, scheduled exports, system sweeps).", security: [{ bearerAuth: [] }], responses: { 200: { description: Schedules } } }
 */
jobsOpsRouter.get("/schedules", requirePermission("jobs:scheduler_read"), async (_req, res) => {
  res.json(await service.schedules());
});

/**
 * @openapi
 * /jobs-ops/schedules/{source}/{id}/action:
 *   post: { tags: [JobsOps], summary: "Pause / resume / run-now a schedule (audited; reason required for critical pause/run). System schedules only support run_now.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: source, required: true, schema: { type: string } }, { in: path, name: id, required: true, schema: { type: string } }], responses: { 200: { description: Result }, 400: { description: Invalid state / missing reason } } }
 */
jobsOpsRouter.post("/schedules/:source/:id/action", requirePermission("jobs:scheduler_manage"), async (req, res) => {
  res.json(
    await service.scheduleAction(
      param(req, "source"),
      param(req, "id"),
      scheduleActionSchema.parse(req.body ?? {}),
      actor(req)
    )
  );
});

/**
 * @openapi
 * /jobs-ops/alerts:
 *   get: { tags: [JobsOps], summary: "Job alerts (Observability L store filtered to job/worker/scheduler types).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
jobsOpsRouter.get("/alerts", requirePermission("jobs:alerts_read"), async (req, res) => {
  res.json(await service.alerts(alertListQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs-ops/alerts/{id}/ack:
 *   post: { tags: [JobsOps], summary: "Acknowledge a job alert (reuses L's one alert store; audited under jobs).", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
jobsOpsRouter.post("/alerts/:id/ack", requirePermission("jobs:alerts_manage"), async (req, res) => {
  res.json(await service.ackAlert(uuidParam(req), alertNoteSchema.parse(req.body ?? {}).note, actor(req)));
});

/**
 * @openapi
 * /jobs-ops/alerts/{id}/resolve:
 *   post: { tags: [JobsOps], summary: "Resolve a job alert (reuses L's one alert store; audited under jobs).", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
jobsOpsRouter.post("/alerts/:id/resolve", requirePermission("jobs:alerts_manage"), async (req, res) => {
  res.json(await service.resolveAlert(uuidParam(req), alertNoteSchema.parse(req.body ?? {}).note, actor(req)));
});

/**
 * @openapi
 * /jobs-ops/retry-policy:
 *   get: { tags: [JobsOps], summary: "Read-only retry policy summary (default max_attempts + exponential backoff base + per-observed-type).", security: [{ bearerAuth: [] }], responses: { 200: { description: Policy } } }
 */
jobsOpsRouter.get("/retry-policy", canRead, async (_req, res) => {
  res.json(await service.retryPolicy());
});

/**
 * @openapi
 * /jobs-ops/reports:
 *   get: { tags: [JobsOps], summary: "Job report aggregates (volume/status/failure/retry/dead-letter/worker/scheduler/queue/long-running/module-wise).", security: [{ bearerAuth: [] }], responses: { 200: { description: Reports } } }
 */
jobsOpsRouter.get("/reports", requirePermission("jobs:reports_read"), async (req, res) => {
  res.json(await service.reports(reportsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs-ops/export:
 *   get: { tags: [JobsOps], summary: "Export filtered jobs as CSV/XLSX (reason ≥5 chars required; every cell masked). Audited.", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" }, 400: { description: Reason required } } }
 */
jobsOpsRouter.get("/export", requirePermission("jobs:export"), async (req, res) => {
  const q = exportQuerySchema.parse(req.query);
  const rows = await service.exportRows(q);
  await service.recordExportAudit(actor(req), { format: q.format, count: rows.length, reason: q.reason });
  sendSpreadsheet(res, q.format, "jobs", service.EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /jobs-ops/integrations:
 *   get: { tags: [JobsOps], summary: "Integration summary linking to Observability (queue/worker/scheduler), Audit (job actions), Security (critical job alerts).", security: [{ bearerAuth: [] }], responses: { 200: { description: Integrations } } }
 */
jobsOpsRouter.get("/integrations", canRead, async (_req, res) => {
  res.json(await service.integrations());
});

/**
 * @openapi
 * /jobs-ops/process:
 *   post: { tags: [JobsOps], summary: "Drain due jobs now (on-demand worker run; audited).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ processed, success, failed, retried }" } } }
 */
jobsOpsRouter.post("/process", requirePermission("jobs:manage"), async (req, res) => {
  res.json(await service.processNow(actor(req)));
});

/**
 * @openapi
 * /jobs-ops/run-scheduler:
 *   post: { tags: [JobsOps], summary: "Run the scheduler tick — enqueue due scheduled reports/backups/exports (audited).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ reports, backups, exports }" } } }
 */
jobsOpsRouter.post("/run-scheduler", requirePermission("jobs:run_scheduler"), async (req, res) => {
  res.json(await service.runScheduler(actor(req)));
});

/**
 * @openapi
 * /jobs-ops/bulk:
 *   post: { tags: [JobsOps], summary: "Bulk retry / cancel / dead-letter (≤500 ids; reason required; per-id state rules; returns affected + skipped). Audited + security event.", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ requested, affected, skipped }" } } }
 */
jobsOpsRouter.post("/bulk", requirePermission("jobs:bulk"), async (req, res) => {
  res.json(await service.bulk(bulkSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}:
 *   get: { tags: [JobsOps], summary: "Full job detail — MASKED payload/error, derived module/queue, related-entity links, attempt timeline, recent audit, retry policy.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 404: { description: Not found } } }
 */
jobsOpsRouter.get("/jobs/:id", canRead, async (req, res) => {
  res.json(await service.getJob(uuidParam(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}/attempts:
 *   get: { tags: [JobsOps], summary: "Append-only per-attempt history (masked error/result), ascending.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ rows }" }, 404: { description: Not found } } }
 */
jobsOpsRouter.get("/jobs/:id/attempts", canRead, async (req, res) => {
  res.json(await service.attempts(uuidParam(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}/retry:
 *   post: { tags: [JobsOps], summary: "Retry a failed or dead-letter job (resets to pending; audited). 400 if not retryable.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 400: { description: Invalid state } } }
 */
jobsOpsRouter.post("/jobs/:id/retry", requirePermission("jobs:retry"), async (req, res) => {
  res.json(await service.retryJob(uuidParam(req), jobActionSchema.parse(req.body ?? {}).reason, actor(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}/cancel:
 *   post: { tags: [JobsOps], summary: "Cancel a pending job (audited). 400 if not pending.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 400: { description: Invalid state } } }
 */
jobsOpsRouter.post("/jobs/:id/cancel", requirePermission("jobs:cancel"), async (req, res) => {
  res.json(await service.cancelJob(uuidParam(req), jobActionSchema.parse(req.body ?? {}).reason, actor(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}/dead-letter:
 *   post: { tags: [JobsOps], summary: "Move a failed job to the dead-letter queue (reason ≥5 required; audited + security event). 400 if not failed.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 400: { description: Invalid state } } }
 */
jobsOpsRouter.post("/jobs/:id/dead-letter", requirePermission("jobs:dead_letter"), async (req, res) => {
  res.json(await service.deadLetter(uuidParam(req), highRiskActionSchema.parse(req.body ?? {}).reason, actor(req)));
});

/**
 * @openapi
 * /jobs-ops/jobs/{id}/requeue:
 *   post: { tags: [JobsOps], summary: "Requeue a dead-letter job (reason ≥5 required; audited). 400 if not dead-letter.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 400: { description: Invalid state } } }
 */
jobsOpsRouter.post("/jobs/:id/requeue", requirePermission("jobs:requeue"), async (req, res) => {
  res.json(await service.requeue(uuidParam(req), highRiskActionSchema.parse(req.body ?? {}).reason, actor(req)));
});
