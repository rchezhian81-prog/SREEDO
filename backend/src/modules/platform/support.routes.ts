import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { uuidParam } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { type Actor, recordAudit } from "./platform.service";
import * as service from "./support.service";
import * as reportsService from "./support-reports.service";
import * as approvalsService from "./support-approvals.service";
import {
  approvalCreateSchema,
  approvalDecisionSchema,
  approvalListQuerySchema,
  exportQuerySchema,
  listQuerySchema,
  reportsExportQuerySchema,
  reportsQuerySchema,
  revokeByOperatorSchema,
  revokeByTenantSchema,
  revokeSchema,
  startSchema,
  summaryQuerySchema,
} from "./support.schema";

/**
 * Super Admin G — Support Access console routes.
 *
 * Owns /platform/support/* (mounted BEFORE the catch-all platform router). Hard
 * gate at router level: authenticate + authorize("super_admin"); granular RBAC per
 * route on top — reads need platform:support_read, start/end needs
 * platform:support_start, revoke needs platform:support_revoke. Read-only over an
 * append-only store: no endpoint here ever hard-deletes a support session.
 *
 * Route order: every literal path is registered BEFORE `/sessions/:id`.
 */
export const platformSupportRouter = Router();
platformSupportRouter.use(authenticate, authorize("super_admin"));

const canRead = requirePermission("platform:support_read");
const canStart = requirePermission("platform:support_start");
const canRevoke = requirePermission("platform:support_revoke");
const canExport = requirePermission("platform:support_export");
const canApprove = requirePermission("platform:support_approve");

const actor = (req: Request): Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Stream a column/row dataset as a CSV or XLSX download (mirrors the Audit
 *  Console's exporter; kept module-local so this router owns its own streaming). */
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
 * /platform/support/summary:
 *   get: { tags: [Platform Support], summary: "Support-access dashboard cards (active/started/ended/expired/revoked, high-risk, by operator/tenant, avg duration, nearing-expiry, recent audit)", security: [{ bearerAuth: [] }], responses: { 200: { description: Summary cards } } }
 */
platformSupportRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.summary(summaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/support/templates:
 *   get: { tags: [Platform Support], summary: "Static reference lists for the UI (reason templates, module keys, scopes)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ templates, modules, scopes }" } } }
 */
platformSupportRouter.get("/templates", canRead, (_req, res) => {
  res.json(service.templates());
});

/**
 * @openapi
 * /platform/support/security-summary:
 *   get: { tags: [Platform Support], summary: "Security-Center support posture (active, long-running, recently revoked, high-risk) — data only", security: [{ bearerAuth: [] }], responses: { 200: { description: Security posture } } }
 */
platformSupportRouter.get("/security-summary", canRead, async (_req, res) => {
  res.json(await service.securitySummary());
});

/**
 * @openapi
 * /platform/support/reports:
 *   get: { tags: [Platform Support], summary: "One of ten support-access report datasets (all/active/expired/revoked/tenant-wise/operator-wise/reason-wise/scope-wise/long-running/high-risk) with filters + totals (sessionCount, avgDurationMinutes, active/revoked/expired, notificationSent/Failed)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: type, schema: { type: string, enum: [all, active, expired, revoked, tenant-wise, operator-wise, reason-wise, scope-wise, long-running, high-risk] } }, { in: query, name: dateFrom, schema: { type: string, format: date } }, { in: query, name: dateTo, schema: { type: string, format: date } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: operatorId, schema: { type: string, format: uuid } }, { in: query, name: status, schema: { type: string } }, { in: query, name: scope, schema: { type: string } }, { in: query, name: reasonTemplate, schema: { type: string } }], responses: { 200: { description: "{ type, filters, totals, rows|groups }" } } }
 */
platformSupportRouter.get("/reports", canRead, async (req, res) => {
  res.json(await reportsService.reports(reportsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/support/reports/export:
 *   get: { tags: [Platform Support], summary: "Export a support-access report as masked CSV/XLSX (curated columns; no secrets). A reason (min 5) is REQUIRED for a broad — no dateFrom — export. Audited as support.report_exported.", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: type, schema: { type: string } }, { in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }, { in: query, name: reason, schema: { type: string, minLength: 5 } }, { in: query, name: dateFrom, schema: { type: string, format: date } }, { in: query, name: dateTo, schema: { type: string, format: date } }], responses: { 200: { description: "CSV or XLSX file" }, 400: { description: "Reason required for a broad export" } } }
 */
platformSupportRouter.get("/reports/export", canExport, async (req, res) => {
  const q = reportsExportQuerySchema.parse(req.query);
  if (!q.dateFrom && (!q.reason || q.reason.trim().length < 5)) {
    throw ApiError.badRequest("A reason (at least 5 characters) is required for a broad report export");
  }
  const { rows } = await reportsService.exportReport(q);
  const { reason, format, ...filters } = q;
  await recordAudit(actor(req), {
    action: "support.report_exported",
    targetType: "platform_impersonation_sessions",
    targetId: null,
    institutionId: null,
    detail: { format, type: q.type, rows: rows.length, reason: reason ?? null, filters },
  });
  sendSpreadsheet(res, format, `support-report-${q.type}`, service.SUPPORT_EXPORT_COLUMNS, rows);
});

/**
 * @openapi
 * /platform/support/export:
 *   get: { tags: [Platform Support], summary: "Export the filtered support-access session history as masked CSV/XLSX (curated columns; no token/secret columns). A reason (min 5) is REQUIRED for a broad — no dateFrom — export. Audited as support.history_exported.", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }, { in: query, name: reason, schema: { type: string, minLength: 5 } }, { in: query, name: dateFrom, schema: { type: string, format: date } }, { in: query, name: dateTo, schema: { type: string, format: date } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: targetId, schema: { type: string, format: uuid } }, { in: query, name: operatorId, schema: { type: string, format: uuid } }, { in: query, name: status, schema: { type: string } }, { in: query, name: scope, schema: { type: string } }, { in: query, name: reasonTemplate, schema: { type: string } }], responses: { 200: { description: "CSV or XLSX file" }, 400: { description: "Reason required for a broad export" } } }
 */
platformSupportRouter.get("/export", canExport, async (req, res) => {
  const q = exportQuerySchema.parse(req.query);
  if (!q.dateFrom && (!q.reason || q.reason.trim().length < 5)) {
    throw ApiError.badRequest("A reason (at least 5 characters) is required for a broad history export");
  }
  const { columns, rows } = await service.exportSessions(q);
  const { reason, format, ...filters } = q;
  await recordAudit(actor(req), {
    action: "support.history_exported",
    targetType: "platform_impersonation_sessions",
    targetId: null,
    institutionId: null,
    detail: { format, rows: rows.length, reason: reason ?? null, filters },
  });
  sendSpreadsheet(res, format, "support-history", columns, rows);
});

/**
 * @openapi
 * /platform/support/approvals:
 *   get: { tags: [Platform Support], summary: "List support-access approval requests (optional status filter; paginated)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: status, schema: { type: string, enum: [pending, approved, rejected] } }, { in: query, name: page, schema: { type: integer } }, { in: query, name: pageSize, schema: { type: integer } }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Platform Support], summary: "Request approval for a would-be high-risk (write-enabled) support session (start params + riskReason). Creates a pending row; audited as support.approval_requested.", security: [{ bearerAuth: [] }], responses: { 201: { description: "Created approval request" }, 400: { description: Invalid target }, 404: { description: User not found } } }
 */
platformSupportRouter.get("/approvals", canRead, async (req, res) => {
  res.json(await approvalsService.listApprovals(approvalListQuerySchema.parse(req.query)));
});
platformSupportRouter.post("/approvals", canRead, async (req, res) => {
  res.status(201).json(await approvalsService.requestApproval(approvalCreateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/support/approvals/{id}/decide:
 *   post: { tags: [Platform Support], summary: "Approve or reject a pending approval request (reason required; audited as support.approval_approved / support.approval_rejected)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "Decided approval" }, 400: { description: "Already decided" }, 404: { description: Not found } } }
 */
platformSupportRouter.post("/approvals/:id/decide", canApprove, async (req, res) => {
  res.json(
    await approvalsService.decideApproval(uuidParam(req), approvalDecisionSchema.parse(req.body), actor(req))
  );
});

/**
 * @openapi
 * /platform/support/sessions/active:
 *   get: { tags: [Platform Support], summary: "Currently-live support sessions (post expiry-sweep)", security: [{ bearerAuth: [] }], responses: { 200: { description: Active sessions } } }
 */
platformSupportRouter.get("/sessions/active", canRead, async (_req, res) => {
  res.json(await service.listActive());
});

/**
 * @openapi
 * /platform/support/sessions:
 *   get: { tags: [Platform Support], summary: "Support session history (filters: date/tenant/target/operator/status/scope/template; paginate/sort)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Platform Support], summary: "Start a governed, scope-enforced support session (reason + expiry required; audited; returns a scoped imp token, never secrets)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ token, expiresAt, session, user }" }, 400: { description: Invalid target/reason/expiry }, 409: { description: An active session already exists } } }
 */
platformSupportRouter.get("/sessions", canRead, async (req, res) => {
  res.json(await service.listSessions(listQuerySchema.parse(req.query)));
});
platformSupportRouter.post("/sessions", canStart, async (req, res) => {
  const result = await service.startSupportSession(startSchema.parse(req.body), actor(req), {
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  });
  res.json(result);
});

/**
 * @openapi
 * /platform/support/sessions/{id}:
 *   get: { tags: [Platform Support], summary: "Single support session detail (secret-masked; ended-by/revoked-by resolved)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Session detail }, 404: { description: Not found } } }
 */
platformSupportRouter.get("/sessions/:id", canRead, async (req, res) => {
  res.json(await service.getSession(uuidParam(req)));
});

/**
 * @openapi
 * /platform/support/sessions/{id}/end:
 *   post: { tags: [Platform Support], summary: "End a support session (audited; idempotent)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ ended }" } } }
 */
platformSupportRouter.post("/sessions/:id/end", canStart, async (req, res) => {
  res.json(await service.endSupportSession({ sessionId: uuidParam(req) }, actor(req)));
});

/**
 * @openapi
 * /platform/support/sessions/{id}/revoke:
 *   post: { tags: [Platform Support], summary: "Revoke a support session (reason required; immediate access loss; audited). No hard delete.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ revoked, alreadyInactive }" }, 404: { description: Not found } } }
 */
platformSupportRouter.post("/sessions/:id/revoke", canRevoke, async (req, res) => {
  const { reason } = revokeSchema.parse(req.body);
  res.json(await service.revokeSession(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /platform/support/revoke-by-operator:
 *   post: { tags: [Platform Support], summary: "Revoke every active session for one operator (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ revoked }" } } }
 */
platformSupportRouter.post("/revoke-by-operator", canRevoke, async (req, res) => {
  const { operatorId, reason } = revokeByOperatorSchema.parse(req.body);
  res.json(await service.revokeByOperator(operatorId, reason, actor(req)));
});

/**
 * @openapi
 * /platform/support/revoke-by-tenant:
 *   post: { tags: [Platform Support], summary: "Revoke every active session touching one tenant (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ revoked }" } } }
 */
platformSupportRouter.post("/revoke-by-tenant", canRevoke, async (req, res) => {
  const { institutionId, reason } = revokeByTenantSchema.parse(req.body);
  res.json(await service.revokeByTenant(institutionId, reason, actor(req)));
});
