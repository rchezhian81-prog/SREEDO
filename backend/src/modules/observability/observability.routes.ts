import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { uuidParam, param } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import * as service from "./observability.service";
import * as incidents from "./incidents.service";
import * as alerts from "./alerts.service";
import * as errors from "./errors.service";
import * as ops from "./opsdashboard.service";
import { recordAudit, type Actor } from "./audit";
import {
  alertAckSchema,
  alertExportQuerySchema,
  alertLinkIncidentSchema,
  alertListQuerySchema,
  alertNoteSchema,
  alertResolveSchema,
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
  errorListQuerySchema,
  errorSummaryQuerySchema,
  errorTriageSchema,
  incidentCreateSchema,
  incidentEventSchema,
  incidentListQuerySchema,
  incidentReopenSchema,
  incidentResolveSchema,
  incidentUpdateSchema,
  logExportQuerySchema,
  logsQuerySchema,
  smtpTestSchema,
  uptimeQuerySchema,
} from "./observability.schema";

// Protected platform observability (super-admin only via observability:* +
// incident/alert/error grants). Public liveness/readiness probes live at the app
// root (/health, /ready). Every route runs under `authenticate` + a per-route
// `requirePermission`, so platform sub-roles / auditor read-only are honoured.
export const observabilityRouter = Router();
observabilityRouter.use(authenticate);

const actor = (req: Request): Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Masked CSV/XLSX response for a curated column set (no secrets / storage paths). */
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

const canRead = requirePermission("observability:read");
const canRun = requirePermission("observability:run");

// ---------------------------------------------------------------------------
// Existing Prometheus / detailed-health / overview endpoints (unchanged).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/metrics:
 *   get: { tags: [Observability], summary: Prometheus metrics (requests, errors, durations, job + scheduled-report counters), security: [{ bearerAuth: [] }], responses: { 200: { description: text/plain exposition } } }
 */
observabilityRouter.get("/metrics", requirePermission("observability:metrics"), async (_req, res) => {
  res.type("text/plain; version=0.0.4").send(await service.renderMetrics());
});

/**
 * @openapi
 * /observability/health:
 *   get: { tags: [Observability], summary: Detailed platform health (DB/Mongo, migrations, queue depth, config), security: [{ bearerAuth: [] }], responses: { 200: { description: Health } } }
 */
observabilityRouter.get("/health", requirePermission("observability:health"), async (_req, res) => {
  res.json(await service.detailedHealth());
});

/**
 * @openapi
 * /observability/overview:
 *   get: { tags: [Observability], summary: Observability overview (request/error/job/queue/scheduled-report summary + recent failures), security: [{ bearerAuth: [] }], responses: { 200: { description: Overview } } }
 */
observabilityRouter.get("/overview", canRead, async (_req, res) => {
  res.json(await service.overview());
});

// ---------------------------------------------------------------------------
// Health / observability dashboard (Super Admin L). Specific paths first.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/summary:
 *   get: { tags: [Observability], summary: "Ops health dashboard (~20 cards: service statuses, queue/error/latency, incidents, alerts, uptime, backup storage). Status only — no secrets.", security: [{ bearerAuth: [] }], responses: { 200: { description: Dashboard } } }
 */
observabilityRouter.get("/summary", canRead, async (_req, res) => {
  res.json(await ops.healthDashboard());
});

/**
 * @openapi
 * /observability/services:
 *   get: { tags: [Observability], summary: "Run service health checks (persists to uptime history) + overall status (status only, no secrets)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ overall, services }" } } }
 */
observabilityRouter.get("/services", canRead, async (_req, res) => {
  res.json(await ops.serviceHealthList());
});

/**
 * @openapi
 * /observability/services/run:
 *   post: { tags: [Observability], summary: "Explicitly run all service health checks (audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ overall, services }" } } }
 */
observabilityRouter.post("/services/run", canRun, async (req, res) => {
  res.json(await ops.runServiceChecks(actor(req)));
});

/**
 * @openapi
 * /observability/services/{name}:
 *   get: { tags: [Observability], summary: "One service's current status + recent uptime history", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: name, required: true, schema: { type: string } }], responses: { 200: { description: Service detail }, 404: { description: Unknown service } } }
 */
observabilityRouter.get("/services/:name", canRead, async (req, res) => {
  res.json(await ops.serviceHealthDetail(param(req, "name")));
});

/**
 * @openapi
 * /observability/uptime:
 *   get: { tags: [Observability], summary: "Per-service uptime % + degraded/down periods from health history", security: [{ bearerAuth: [] }], responses: { 200: { description: Uptime } } }
 */
observabilityRouter.get("/uptime", canRead, async (req, res) => {
  res.json(await ops.uptimeHistory(uptimeQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /observability/performance:
 *   get: { tags: [Observability], summary: "Request volume / error rate / avg + per-route p95 + slowest routes (since deployment)", security: [{ bearerAuth: [] }], responses: { 200: { description: Performance } } }
 */
observabilityRouter.get("/performance", canRead, (_req, res) => {
  res.json(ops.performance());
});

/**
 * @openapi
 * /observability/storage:
 *   get: { tags: [Observability], summary: "Storage usage (backups + exports + documents) by category + by tenant vs limit. No raw paths.", security: [{ bearerAuth: [] }], responses: { 200: { description: Storage } } }
 */
observabilityRouter.get("/storage", canRead, async (_req, res) => {
  res.json(await ops.storageDashboard());
});

/**
 * @openapi
 * /observability/smtp:
 *   get: { tags: [Observability], summary: "SMTP health (verify + invoice-email delivery counts + masked failed recipients). Status only.", security: [{ bearerAuth: [] }], responses: { 200: { description: SMTP health } } }
 */
observabilityRouter.get("/smtp", canRead, async (_req, res) => {
  res.json(await ops.smtpHealth());
});

/**
 * @openapi
 * /observability/smtp/test:
 *   post: { tags: [Observability], summary: "Send a test email + report status only (audited; never returns the SMTP error detail)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ ok, recipient }" } } }
 */
observabilityRouter.post("/smtp/test", canRun, async (req, res) => {
  const { to } = smtpTestSchema.parse(req.body ?? {});
  res.json(await ops.sendSmtpTest(to, actor(req)));
});

/**
 * @openapi
 * /observability/jobs-health:
 *   get: { tags: [Observability], summary: "Queue depth / stuck / failed-trend / retry summary (links to the jobs console)", security: [{ bearerAuth: [] }], responses: { 200: { description: Jobs health } } }
 */
observabilityRouter.get("/jobs-health", canRead, async (_req, res) => {
  res.json(await ops.jobsHealth());
});

/**
 * @openapi
 * /observability/integrations:
 *   get: { tags: [Observability], summary: "Integration health cards (backups / exports / security / audit) via the reused summaries", security: [{ bearerAuth: [] }], responses: { 200: { description: Integrations } } }
 */
observabilityRouter.get("/integrations", canRead, async (_req, res) => {
  res.json(await ops.integrations());
});

// ---------------------------------------------------------------------------
// Incidents.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/incidents:
 *   get: { tags: [Observability], summary: "List incidents (filter status/severity/type/date; paginated)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Observability], summary: "Open an incident (audited; critical also raises a security event)", security: [{ bearerAuth: [] }], responses: { 201: { description: Incident } } }
 */
observabilityRouter.get("/incidents", requirePermission("incident:read"), async (req, res) => {
  res.json(await incidents.listIncidents(incidentListQuerySchema.parse(req.query)));
});
observabilityRouter.post("/incidents", requirePermission("incident:create"), async (req, res) => {
  res.status(201).json(await incidents.createIncident(incidentCreateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/incidents/{id}:
 *   get: { tags: [Observability], summary: "Get an incident + its timeline", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Incident }, 404: { description: Not found } } }
 *   patch: { tags: [Observability], summary: "Update an incident (status/severity/assignee/notes → timeline + audit; no hard delete)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Incident } } }
 */
observabilityRouter.get("/incidents/:id", requirePermission("incident:read"), async (req, res) => {
  res.json(await incidents.getIncident(uuidParam(req)));
});
observabilityRouter.patch("/incidents/:id", requirePermission("incident:update"), async (req, res) => {
  res.json(await incidents.updateIncident(uuidParam(req), incidentUpdateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/incidents/{id}/resolve:
 *   post: { tags: [Observability], summary: "Resolve an incident (sets resolved_at; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Incident } } }
 */
observabilityRouter.post("/incidents/:id/resolve", requirePermission("incident:resolve"), async (req, res) => {
  res.json(await incidents.resolveIncident(uuidParam(req), incidentResolveSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/incidents/{id}/reopen:
 *   post: { tags: [Observability], summary: "Reopen a resolved/closed incident (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Incident } } }
 */
observabilityRouter.post("/incidents/:id/reopen", requirePermission("incident:resolve"), async (req, res) => {
  res.json(await incidents.reopenIncident(uuidParam(req), incidentReopenSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/incidents/{id}/events:
 *   post: { tags: [Observability], summary: "Append a note to an incident timeline (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Incident } } }
 */
observabilityRouter.post("/incidents/:id/events", requirePermission("incident:update"), async (req, res) => {
  res.json(await incidents.addIncidentEvent(uuidParam(req), incidentEventSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Alert rules.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/alert-rules:
 *   get: { tags: [Observability], summary: "List alert rules", security: [{ bearerAuth: [] }], responses: { 200: { description: Rules } } }
 *   post: { tags: [Observability], summary: "Create an alert rule (audited)", security: [{ bearerAuth: [] }], responses: { 201: { description: Rule } } }
 */
observabilityRouter.get("/alert-rules", requirePermission("alert:read"), async (_req, res) => {
  res.json(await alerts.listAlertRules());
});
observabilityRouter.post("/alert-rules", requirePermission("alert:manage"), async (req, res) => {
  res.status(201).json(await alerts.createAlertRule(alertRuleCreateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/alert-rules/{id}:
 *   patch: { tags: [Observability], summary: "Update / enable / disable an alert rule (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Rule } } }
 */
observabilityRouter.patch("/alert-rules/:id", requirePermission("alert:manage"), async (req, res) => {
  res.json(await alerts.updateAlertRule(uuidParam(req), alertRuleUpdateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/alert-rules/{id}/test:
 *   post: { tags: [Observability], summary: "Fire a synthetic (suppressed) test alert for a rule — no real notification (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ tested, alert }" } } }
 */
observabilityRouter.post("/alert-rules/:id/test", requirePermission("alert:manage"), async (req, res) => {
  res.json(await alerts.testRule(uuidParam(req), actor(req)));
});

// ---------------------------------------------------------------------------
// Alert feed. /alerts/export before the /alerts/:id action routes.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/alerts:
 *   get: { tags: [Observability], summary: "Alert feed (filter status/severity/date; paginated)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
observabilityRouter.get("/alerts", requirePermission("alert:read"), async (req, res) => {
  res.json(await alerts.listAlerts(alertListQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /observability/alerts/export:
 *   get: { tags: [Observability], summary: "Export the alert feed as CSV/XLSX (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" } } }
 */
observabilityRouter.get("/alerts/export", requirePermission("alert:read"), async (req, res) => {
  const q = alertExportQuerySchema.parse(req.query);
  const rows = await alerts.alertExportRows(q);
  await recordAudit(actor(req), {
    action: "alert.exported",
    targetType: "alert",
    targetId: null,
    detail: { format: q.format, count: rows.length, reason: q.reason },
  });
  sendSpreadsheet(res, q.format, "alerts", alerts.ALERT_EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /observability/alerts/{id}/ack:
 *   post: { tags: [Observability], summary: "Acknowledge an alert (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
observabilityRouter.post("/alerts/:id/ack", requirePermission("alert:ack"), async (req, res) => {
  res.json(await alerts.ackAlert(uuidParam(req), alertAckSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/alerts/{id}/resolve:
 *   post: { tags: [Observability], summary: "Resolve an alert (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
observabilityRouter.post("/alerts/:id/resolve", requirePermission("alert:ack"), async (req, res) => {
  res.json(await alerts.resolveAlert(uuidParam(req), alertResolveSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/alerts/{id}/link-incident:
 *   post: { tags: [Observability], summary: "Link an alert to an incident (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
observabilityRouter.post("/alerts/:id/link-incident", requirePermission("alert:ack"), async (req, res) => {
  res.json(await alerts.linkIncident(uuidParam(req), alertLinkIncidentSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /observability/alerts/{id}/note:
 *   post: { tags: [Observability], summary: "Add a note to an alert (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Alert } } }
 */
observabilityRouter.post("/alerts/:id/note", requirePermission("alert:ack"), async (req, res) => {
  res.json(await alerts.addAlertNote(uuidParam(req), alertNoteSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Error explorer. /errors/summary before /errors/:id.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/errors:
 *   get: { tags: [Observability], summary: "Error explorer list (filter route/status/type/triage/date; masked messages)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
observabilityRouter.get("/errors", requirePermission("error:read"), async (req, res) => {
  res.json(await errors.listErrors(errorListQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /observability/errors/summary:
 *   get: { tags: [Observability], summary: "Error aggregates (by route, by status class, totals)", security: [{ bearerAuth: [] }], responses: { 200: { description: Summary } } }
 */
observabilityRouter.get("/errors/summary", requirePermission("error:read"), async (req, res) => {
  res.json(await errors.errorSummary(errorSummaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /observability/errors/{id}:
 *   get: { tags: [Observability], summary: "Get one captured error (masked)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Error } } }
 *   patch: { tags: [Observability], summary: "Triage a captured error (new/investigating/resolved/ignored; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Error } } }
 */
observabilityRouter.get("/errors/:id", requirePermission("error:read"), async (req, res) => {
  res.json(await errors.getError(uuidParam(req)));
});
observabilityRouter.patch("/errors/:id", requirePermission("error:read"), async (req, res) => {
  res.json(await errors.triageError(uuidParam(req), errorTriageSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Logs (safe summary + reason-gated export).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /observability/logs:
 *   get: { tags: [Observability], summary: "Safe recent log summary (masked error_events + audit)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ source, errors, audit }" } } }
 */
observabilityRouter.get("/logs", canRead, async (req, res) => {
  res.json(await ops.logsSummary(logsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /observability/logs/export:
 *   get: { tags: [Observability], summary: "Export a broad, masked log as CSV/XLSX (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" } } }
 */
observabilityRouter.get("/logs/export", canRun, async (req, res) => {
  const q = logExportQuerySchema.parse(req.query);
  const rows = await ops.logExportRows(q);
  await recordAudit(actor(req), {
    action: "observability.logs_exported",
    targetType: "observability",
    targetId: null,
    detail: { format: q.format, source: q.source, count: rows.length, reason: q.reason },
  });
  sendSpreadsheet(res, q.format, "observability-logs", ops.LOG_EXPORT_COLUMNS, rows);
});
