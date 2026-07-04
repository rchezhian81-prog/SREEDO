import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { platformIpGate } from "../../middleware/platform-ip-gate";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { uuidParam } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { recordAudit } from "./platform.service";
import * as service from "./audit.service";
import {
  auditAlertsQuerySchema,
  auditExportQuerySchema,
  auditListQuerySchema,
  auditSummaryQuerySchema,
  retentionUpdateSchema,
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
} from "./audit.schema";

/**
 * Super Admin F — Audit Consolidation routes.
 *
 * Owns /platform/audit/* (mounted BEFORE the platform router). Hard boundary:
 * authenticate + authorize("super_admin") + the platform IP gate at ROUTER level;
 * granular RBAC per route on top — reads need platform:audit_read, export needs
 * platform:audit_export, retention management needs platform:audit_manage. Read-
 * only over an append-only store: no endpoint here ever deletes an audit row.
 *
 * Route order matters: every literal path is registered BEFORE the `/:id`
 * catch-all so `/summary`, `/export`, etc. are never swallowed by the UUID route.
 */
export const platformAuditRouter = Router();
platformAuditRouter.use(authenticate, authorize("super_admin"), platformIpGate);

const canRead = requirePermission("platform:audit_read");
const canExport = requirePermission("platform:audit_export");
const canManage = requirePermission("platform:audit_manage");

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Stream a column/row dataset as a CSV or XLSX download (copied from the platform
 *  router; kept module-local so this router owns its own export streaming). */
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

/**
 * @openapi
 * /platform/audit:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Consolidated cross-tenant audit log (computed category/severity/result; search/filter/sort/paginate)"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: institutionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: actorId, schema: { type: string, format: uuid } }
 *       - { in: query, name: actorRole, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: targetType, schema: { type: string } }
 *       - { in: query, name: targetId, schema: { type: string } }
 *       - { in: query, name: ip, schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string, enum: [info, warning, high_risk, critical] } }
 *       - { in: query, name: result, schema: { type: string, enum: [success, failed, blocked] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string, description: "alias for category" } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: pageSize, schema: { type: integer, maximum: 200 } }
 *       - { in: query, name: sort, schema: { type: string, enum: [createdAt, action, actorEmail, severity] } }
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc] } }
 *     responses:
 *       200: { description: "Paged audit { rows, total, page, pageSize }" }
 */
platformAuditRouter.get("/", canRead, async (req, res) => {
  res.json(await service.listEvents(auditListQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/audit/summary:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Dashboard cards over a window (totals, high-risk, failed/blocked, category buckets, top actors/tenants, recent critical)"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, custom] } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "Summary cards" }
 */
platformAuditRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.summary(auditSummaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/audit/categories:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Taxonomy reference for the filter dropdowns (categories + severities + result values)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ categories, severities, results }" }
 */
platformAuditRouter.get("/categories", canRead, async (_req, res) => {
  res.json(service.categoriesReference());
});

/**
 * @openapi
 * /platform/audit/alerts:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Read-only suspicious-activity feed (failed logins, owner/RBAC change, sensitive export, restore, impersonation, tenant suspend, gateway change, API token, IP allowlist, 2FA reset); each links an audit row id"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, custom] } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ window, alerts }" }
 */
platformAuditRouter.get("/alerts", canRead, async (req, res) => {
  res.json(await service.alerts(auditAlertsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/audit/integrity:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Integrity status (hash-chaining not enabled; rows are append-only and never hard-deleted)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ enabled, status, note }" }
 */
platformAuditRouter.get("/integrity", canRead, async (_req, res) => {
  res.json(service.integrity());
});

/**
 * @openapi
 * /platform/audit/retention:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Audit retention policy + live stats (policy visibility only — never auto-deletes history)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ status, retentionDays, archiveEnabled, updatedByEmail, updatedAt, stats }" }
 *   put:
 *     tags: [Platform Audit]
 *     summary: "Update the retention policy (audited). retentionDays 30..3650 or null. Does NOT delete rows."
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [retentionDays]
 *             properties:
 *               retentionDays: { type: integer, nullable: true, minimum: 30, maximum: 3650 }
 *               archiveEnabled: { type: boolean }
 *     responses:
 *       200: { description: "Updated policy + stats" }
 */
platformAuditRouter.get("/retention", canRead, async (_req, res) => {
  res.json(await service.getRetention());
});
platformAuditRouter.put("/retention", canManage, async (req, res) => {
  res.json(await service.updateRetention(retentionUpdateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/audit/saved-filters:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "List the caller's saved filters plus every shared filter"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Saved filters" }
 *   post:
 *     tags: [Platform Audit]
 *     summary: "Create a saved filter (name + filters JSON; optional isShared/isDefault). Sharing is audited."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "Created filter" }
 */
platformAuditRouter.get("/saved-filters", canRead, async (req, res) => {
  res.json(await service.listSavedFilters(req.user!.id));
});
platformAuditRouter.post("/saved-filters", canRead, async (req, res) => {
  res.status(201).json(await service.createSavedFilter(savedFilterCreateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/audit/saved-filters/{id}:
 *   patch:
 *     tags: [Platform Audit]
 *     summary: "Update a saved filter (owner, or any super_admin for a shared filter). Shared changes are audited."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "Updated filter" }
 *       403: { description: "Not the owner of a private filter" }
 *   delete:
 *     tags: [Platform Audit]
 *     summary: "Delete a saved filter (owner, or any super_admin for a shared filter). Shared deletes are audited. Hard delete — a filter is not audit history."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ deleted }" }
 */
platformAuditRouter.patch("/saved-filters/:id", canRead, async (req, res) => {
  res.json(await service.updateSavedFilter(uuidParam(req), savedFilterUpdateSchema.parse(req.body), actor(req)));
});
platformAuditRouter.delete("/saved-filters/:id", canRead, async (req, res) => {
  res.json(await service.deleteSavedFilter(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /platform/audit/export:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Governed CSV/XLSX export (same filters as the list). Every cell is masked of secrets. A reason (min 5) is REQUIRED for a broad (no dateFrom) or high-severity export. Audited as audit.exported. Cap 50000."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }
 *       - { in: query, name: reason, schema: { type: string, minLength: 5 } }
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: institutionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: actorId, schema: { type: string, format: uuid } }
 *       - { in: query, name: actorRole, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: targetType, schema: { type: string } }
 *       - { in: query, name: targetId, schema: { type: string } }
 *       - { in: query, name: ip, schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string, enum: [info, warning, high_risk, critical] } }
 *       - { in: query, name: result, schema: { type: string, enum: [success, failed, blocked] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "CSV or XLSX file of the filtered, masked audit log" }
 *       400: { description: "Reason required for a broad / high-severity export" }
 */
platformAuditRouter.get("/export", canExport, async (req, res) => {
  const q = auditExportQuerySchema.parse(req.query);
  if (service.exportNeedsReason(q) && (!q.reason || q.reason.trim().length < 5)) {
    throw ApiError.badRequest(
      "A reason (at least 5 characters) is required for a broad or high-severity audit export"
    );
  }
  const rows = await service.exportRows(q);
  const { reason, format, ...filters } = q;
  await recordAudit(actor(req), {
    action: "audit.exported",
    targetType: "platform_audit_log",
    targetId: null,
    institutionId: null,
    detail: { format, rows: rows.length, reason: reason ?? null, filters },
  });
  sendSpreadsheet(res, format, "platform-audit", service.EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /platform/audit/{id}:
 *   get:
 *     tags: [Platform Audit]
 *     summary: "Single audit event — computed category/severity/result + actor, target (display name best-effort), institution, userAgent, reason, extracted diff, and the full detail AFTER masking"
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "Event detail" }
 *       404: { description: "Not found" }
 */
platformAuditRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getEvent(uuidParam(req)));
});
