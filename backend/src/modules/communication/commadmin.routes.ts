import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { uuidParam, param } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import * as service from "./commadmin.service";
import {
  broadcastCancelSchema,
  broadcastCreateSchema,
  broadcastListQuerySchema,
  broadcastPreviewAudienceSchema,
  broadcastScheduleSchema,
  broadcastSendSchema,
  broadcastUpdateSchema,
  deliveryExportQuerySchema,
  deliveryListQuerySchema,
  deliveryRetrySchema,
  preferencesUpdateSchema,
  providerTestSchema,
  reportsExportQuerySchema,
  reportsQuerySchema,
  summaryQuerySchema,
  templateCreateSchema,
  templateListQuerySchema,
  templatePreviewSchema,
  templatePublishSchema,
  templateRestoreSchema,
  templateTestSchema,
  templateUpdateSchema,
} from "./commadmin.schema";

/**
 * Super Admin O — Communication Admin router.
 *
 * A NEW router mounted at /comm-admin (the existing tenant `/communication`
 * router is 100% untouched). Every route runs under `authenticate` + a router-
 * level `authorize("super_admin")` (platform boundary) + a per-route
 * `requirePermission` using the granular 0102 `comm:*` perms — RBAC is enforced
 * SERVER-SIDE. Platform sub-roles (owner/auditor) carry user_role='super_admin',
 * so they pass `authorize` and are then narrowed by the per-route permission (the
 * auditor holds only the read-only comm perms). Every mutation is audited in the
 * service layer; broad broadcasts + disabling security notifications also raise a
 * security event.
 */
export const commAdminRouter = Router();
commAdminRouter.use(authenticate);
commAdminRouter.use(authorize("super_admin"));

const actor = (req: Request): service.Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Masked CSV/XLSX response for a curated column set (no secrets / links). */
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

// ---------------------------------------------------------------------------
// Dashboard + provider.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/summary:
 *   get: { tags: [CommAdmin], summary: "Communication dashboard (~18 cards: provider status, templates, emails sent/failed today, broadcasts, per-source counts, recent failures, comm-health warning). Masked, no secrets.", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: window, schema: { type: string, enum: [today, 24h, 7d, 30d, custom] } }], responses: { 200: { description: Dashboard } } }
 */
commAdminRouter.get("/summary", requirePermission("comm:dashboard_read"), async (req, res) => {
  res.json(await service.dashboard(summaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /comm-admin/provider:
 *   get: { tags: [CommAdmin], summary: "SMTP provider status — SAFE fields only (configured/status, parsed fromName/fromEmail, last test/success/failure, failure count). NEVER exposes user/pass/host.", security: [{ bearerAuth: [] }], responses: { 200: { description: Provider status } } }
 */
commAdminRouter.get("/provider", requirePermission("comm:dashboard_read"), async (_req, res) => {
  res.json(await service.providerStatus());
});

/**
 * @openapi
 * /comm-admin/provider/test:
 *   post: { tags: [CommAdmin], summary: "Send a test email (optionally rendering a template with sample data). External (non-test) recipients require a reason. Audited; logs a manual_test delivery.", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ sent, status, deliveryId, preview }" }, 400: { description: Reason required } } }
 */
commAdminRouter.post("/provider/test", requirePermission("comm:test_send"), async (req, res) => {
  res.json(await service.sendTest(providerTestSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Templates. Collection routes first, then /:key, then /:key/* actions.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/templates:
 *   get: { tags: [CommAdmin], summary: "List email templates (filter q/category/status/builtin; paginated).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [CommAdmin], summary: "Create a custom template (is_builtin=false; v1 snapshot). Audited.", security: [{ bearerAuth: [] }], responses: { 201: { description: Template } } }
 */
commAdminRouter.get("/templates", requirePermission("comm:templates_read"), async (req, res) => {
  res.json(await service.listTemplates(templateListQuerySchema.parse(req.query)));
});
commAdminRouter.post("/templates", requirePermission("comm:template_create"), async (req, res) => {
  res.status(201).json(await service.createTemplate(templateCreateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /comm-admin/templates/{key}:
 *   get: { tags: [CommAdmin], summary: "Get a template + its version history.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Template }, 404: { description: Not found } } }
 *   patch: { tags: [CommAdmin], summary: "Edit a template — bumps version + snapshots the prior content (append-only). Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Template } } }
 */
commAdminRouter.get("/templates/:key", requirePermission("comm:templates_read"), async (req, res) => {
  res.json(await service.getTemplate(param(req, "key")));
});
commAdminRouter.patch("/templates/:key", requirePermission("comm:template_edit"), async (req, res) => {
  res.json(await service.updateTemplate(param(req, "key"), templateUpdateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /comm-admin/templates/{key}/publish:
 *   post: { tags: [CommAdmin], summary: "Publish / disable a template (active|disabled|draft). Built-ins are never deleted, only disabled. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Template } } }
 */
commAdminRouter.post("/templates/:key/publish", requirePermission("comm:template_publish"), async (req, res) => {
  res.json(await service.publishTemplate(param(req, "key"), templatePublishSchema.parse(req.body ?? {}).status, actor(req)));
});

/**
 * @openapi
 * /comm-admin/templates/{key}/versions:
 *   get: { tags: [CommAdmin], summary: "List a template's append-only version history.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: "{ key, version, versions }" } } }
 */
commAdminRouter.get("/templates/:key/versions", requirePermission("comm:templates_read"), async (req, res) => {
  res.json(await service.versions(param(req, "key")));
});

/**
 * @openapi
 * /comm-admin/templates/{key}/restore:
 *   post: { tags: [CommAdmin], summary: "Restore a previous version — writes a NEW version from the old content + bumps version. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Template }, 404: { description: Version not found } } }
 */
commAdminRouter.post("/templates/:key/restore", requirePermission("comm:template_restore"), async (req, res) => {
  const body = templateRestoreSchema.parse(req.body ?? {});
  res.json(await service.restoreVersion(param(req, "key"), body.version, body.changeNote, actor(req)));
});

/**
 * @openapi
 * /comm-admin/templates/{key}/preview:
 *   post: { tags: [CommAdmin], summary: "Render a template with sample data — flags unknown {{vars}}, strips scripts, never resolves a secret.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: "{ subject, bodyText, bodyHtml, unknownVars }" } } }
 */
commAdminRouter.post("/templates/:key/preview", requirePermission("comm:templates_read"), async (req, res) => {
  res.json(await service.previewTemplate(param(req, "key"), templatePreviewSchema.parse(req.body ?? {})));
});

/**
 * @openapi
 * /comm-admin/templates/{key}/test:
 *   post: { tags: [CommAdmin], summary: "Send a test of this template. External (non-test) recipients require a reason. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: "{ sent, status, deliveryId }" }, 400: { description: Reason required } } }
 */
commAdminRouter.post("/templates/:key/test", requirePermission("comm:test_send"), async (req, res) => {
  const body = templateTestSchema.parse(req.body ?? {});
  res.json(await service.sendTest({ ...body, templateKey: param(req, "key") }, actor(req)));
});

// ---------------------------------------------------------------------------
// Deliveries. /deliveries/export BEFORE /deliveries/:id.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/deliveries:
 *   get: { tags: [CommAdmin], summary: "Unified delivery log (email_deliveries UNION legacy invoice_emails). Search/filter/paginate/sort; masked (no secrets/links).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
commAdminRouter.get("/deliveries", requirePermission("comm:deliveries_read"), async (req, res) => {
  res.json(await service.listDeliveries(deliveryListQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /comm-admin/deliveries/export:
 *   get: { tags: [CommAdmin], summary: "Export the delivery log as CSV/XLSX (reason ≥5 required; every cell masked). Audited.", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" }, 400: { description: Reason required } } }
 */
commAdminRouter.get("/deliveries/export", requirePermission("comm:deliveries_export"), async (req, res) => {
  const q = deliveryExportQuerySchema.parse(req.query);
  const rows = await service.deliveryExportRows(q);
  await service.recordDeliveryExportAudit(actor(req), { format: q.format, count: rows.length, reason: q.reason });
  sendSpreadsheet(res, q.format, "email-deliveries", service.EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /comm-admin/deliveries/{id}:
 *   get: { tags: [CommAdmin], summary: "One delivery (masked failure/provider/subject; secure links omitted).", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Delivery }, 404: { description: Not found } } }
 */
commAdminRouter.get("/deliveries/:id", requirePermission("comm:deliveries_read"), async (req, res) => {
  res.json(await service.getDelivery(uuidParam(req)));
});

/**
 * @openapi
 * /comm-admin/deliveries/{id}/retry:
 *   post: { tags: [CommAdmin], summary: "Retry a FAILED email delivery (append-only re-send; increments retry_count). Legacy invoice deliveries are read-only. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ retried, status, delivery }" }, 400: { description: Not retryable } } }
 */
commAdminRouter.post("/deliveries/:id/retry", requirePermission("comm:delivery_retry"), async (req, res) => {
  res.json(await service.retryDelivery(uuidParam(req), deliveryRetrySchema.parse(req.body ?? {}).reason, actor(req)));
});

// ---------------------------------------------------------------------------
// Broadcasts.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/broadcasts:
 *   get: { tags: [CommAdmin], summary: "List broadcasts (filter q/status/audience; paginated).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [CommAdmin], summary: "Create a broadcast (draft). Audited.", security: [{ bearerAuth: [] }], responses: { 201: { description: Broadcast } } }
 */
commAdminRouter.get("/broadcasts", requirePermission("comm:broadcasts_read"), async (req, res) => {
  res.json(await service.listBroadcasts(broadcastListQuerySchema.parse(req.query)));
});
commAdminRouter.post("/broadcasts", requirePermission("comm:broadcast_create"), async (req, res) => {
  res.status(201).json(await service.createBroadcast(broadcastCreateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /comm-admin/broadcasts/{id}:
 *   get: { tags: [CommAdmin], summary: "Get a broadcast (+ counts).", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Broadcast }, 404: { description: Not found } } }
 *   patch: { tags: [CommAdmin], summary: "Edit a DRAFT broadcast. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Broadcast }, 400: { description: Not a draft } } }
 */
commAdminRouter.get("/broadcasts/:id", requirePermission("comm:broadcasts_read"), async (req, res) => {
  res.json(await service.getBroadcast(uuidParam(req)));
});
commAdminRouter.patch("/broadcasts/:id", requirePermission("comm:broadcast_create"), async (req, res) => {
  res.json(await service.updateBroadcast(uuidParam(req), broadcastUpdateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /comm-admin/broadcasts/{id}/preview-audience:
 *   post: { tags: [CommAdmin], summary: "Resolve the recipient COUNT for the broadcast's (or an ad-hoc) audience.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ audience, recipientCount, broad }" } } }
 */
commAdminRouter.post("/broadcasts/:id/preview-audience", requirePermission("comm:broadcasts_read"), async (req, res) => {
  res.json(await service.previewAudience(uuidParam(req), broadcastPreviewAudienceSchema.parse(req.body ?? {})));
});

/**
 * @openapi
 * /comm-admin/broadcasts/{id}/send:
 *   post: { tags: [CommAdmin], summary: "Send a broadcast (status→sending; enqueues a broadcast_send job). Broad audiences (all_tenants/tenant_admins/institution_type) require a reason ≥5 + raise a security event. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Broadcast }, 400: { description: Invalid state / reason required } } }
 */
commAdminRouter.post("/broadcasts/:id/send", requirePermission("comm:broadcast_send"), async (req, res) => {
  res.json(await service.sendBroadcast(uuidParam(req), broadcastSendSchema.parse(req.body ?? {}).reason, actor(req)));
});

/**
 * @openapi
 * /comm-admin/broadcasts/{id}/schedule:
 *   post: { tags: [CommAdmin], summary: "Schedule a broadcast (status→scheduled). The worker tick enqueues it when due. Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Broadcast }, 400: { description: Invalid state } } }
 */
commAdminRouter.post("/broadcasts/:id/schedule", requirePermission("comm:broadcast_schedule"), async (req, res) => {
  res.json(await service.scheduleBroadcast(uuidParam(req), broadcastScheduleSchema.parse(req.body ?? {}).scheduledAt, actor(req)));
});

/**
 * @openapi
 * /comm-admin/broadcasts/{id}/cancel:
 *   post: { tags: [CommAdmin], summary: "Cancel a SCHEDULED broadcast (status→cancelled; never hard-deleted). Audited.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Broadcast }, 400: { description: Not scheduled } } }
 */
commAdminRouter.post("/broadcasts/:id/cancel", requirePermission("comm:broadcast_cancel"), async (req, res) => {
  res.json(await service.cancelBroadcast(uuidParam(req), broadcastCancelSchema.parse(req.body ?? {}).reason, actor(req)));
});

// ---------------------------------------------------------------------------
// Preferences.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/preferences:
 *   get: { tags: [CommAdmin], summary: "Global notification category defaults (singleton).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ categories, updatedBy, updatedAt }" } } }
 *   patch: { tags: [CommAdmin], summary: "Update notification categories. Disabling the security-critical category is allowed but returns a warning + is audited + raises a security event (never silently disabled).", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ categories, warning }" } } }
 */
commAdminRouter.get("/preferences", requirePermission("comm:preferences_manage"), async (_req, res) => {
  res.json(await service.getPreferences());
});
commAdminRouter.patch("/preferences", requirePermission("comm:preferences_manage"), async (req, res) => {
  res.json(await service.updatePreferences(preferencesUpdateSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Reports + integrations. /reports/export BEFORE nothing dynamic (static path).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /comm-admin/reports:
 *   get: { tags: [CommAdmin], summary: "Communication report aggregates (status, template usage, category, source, tenant, broadcasts, test/security). Filterable by window/source/category/tenant.", security: [{ bearerAuth: [] }], responses: { 200: { description: Reports } } }
 */
commAdminRouter.get("/reports", requirePermission("comm:reports_read"), async (req, res) => {
  res.json(await service.reports(reportsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /comm-admin/reports/export:
 *   get: { tags: [CommAdmin], summary: "Export template-usage report as CSV/XLSX (reason ≥5 required). Audited.", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" }, 400: { description: Reason required } } }
 */
commAdminRouter.get("/reports/export", requirePermission("comm:reports_export"), async (req, res) => {
  const q = reportsExportQuerySchema.parse(req.query);
  const rows = await service.reportsExportRows(q);
  await service.recordReportExportAudit(actor(req), { format: q.format, count: rows.length, reason: q.reason });
  sendSpreadsheet(res, q.format, "communication-reports", service.REPORT_EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /comm-admin/integrations:
 *   get: { tags: [CommAdmin], summary: "Integration links — SMTP health (Observability), email/broadcast job summary, comm security events, comm.* audit count.", security: [{ bearerAuth: [] }], responses: { 200: { description: Integrations } } }
 */
commAdminRouter.get("/integrations", requirePermission("comm:dashboard_read"), async (_req, res) => {
  res.json(await service.integrations());
});
