import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { param, uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { mailerConfigured, sendTestEmail, verifyMailer } from "../../utils/mailer";
import { clientIp, recordSecurityEvent } from "../../utils/security-audit";
import {
  assignSubscriptionSchema,
  auditExportQuerySchema,
  createInstitutionSchema,
  grantPermissionSchema,
  impersonateSchema,
  institutionExportQuerySchema,
  listInstitutionsQuerySchema,
  platformAuditQuerySchema,
  roleParamSchema,
  setLimitsSchema,
  suspendSchema,
  updateInstitutionSchema,
  userSearchQuerySchema,
} from "./platform.schema";
import * as service from "./platform.service";
import * as billing from "../billing/billing.service";
import * as invoices from "../billing/invoices.service";
import * as invoiceSettings from "../billing/invoice-settings.service";
import * as notes from "../billing/notes.service";
import {
  createInvoiceSchema,
  institutionInvoicesQuerySchema,
  invoiceExportQuerySchema,
  invoiceLineSchema,
  invoiceSettingsSchema,
  listInvoicesQuerySchema,
  markPaidSchema,
  reportQuerySchema,
  updateInvoiceSchema,
  updateLineSchema,
  voidInvoiceSchema,
} from "../billing/invoices.schema";
import { applyCouponSchema } from "../billing/coupons.schema";
import {
  createNoteSchema,
  noteLineSchema,
  noteListQuerySchema,
  updateNoteLineSchema,
  updateNoteSchema,
  voidNoteSchema,
} from "../billing/notes.schema";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";

// The platform console sits ABOVE any tenant: super-admin-only (actor
// institution_id = null). authorize("super_admin") is the hard role boundary;
// requirePermission documents/enforces the granular platform:* model on top.
export const platformRouter = Router();
platformRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * Record a money-action audit row for an invoice (or invoice settings) into the
 * shared platform_audit_log. Best-effort (never throws); user-agent rides in the
 * detail. Awaited so the timeline reflects the action immediately.
 */
async function invoiceAudit(
  req: Request,
  action: string,
  targetId: string | null,
  institutionId: string | null,
  detail: Record<string, unknown> = {},
  targetType = "saas_invoice"
): Promise<void> {
  await recordSecurityEvent({
    action,
    targetType,
    targetId,
    institutionId,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    detail: { ...detail, userAgent: req.get("user-agent") ?? null },
    ip: clientIp(req),
  });
}

/** Stream a column/row dataset as a CSV or XLSX download (optional totals row). */
function sendSpreadsheet(
  res: Response,
  format: "csv" | "xlsx",
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
  totals?: Record<string, unknown> | null
): void {
  const headers = columns.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (totals) {
    data.push(
      columns.map((c, i) => (c.key in totals ? (totals[c.key] as Cell) : i === 0 ? "TOTAL" : ""))
    );
  }
  if (format === "xlsx") {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
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
 * /platform/kpis:
 *   get: { tags: [Platform], summary: Platform-wide KPIs (all institutions), security: [{ bearerAuth: [] }], responses: { 200: { description: KPIs + module adoption } } }
 */
platformRouter.get("/kpis", requirePermission("platform:usage_read"), async (_req, res) => {
  res.json(await service.platformKpis());
});

/**
 * @openapi
 * /platform/health:
 *   get: { tags: [Platform], summary: Platform health (DB/Mongo/counts/uptime), security: [{ bearerAuth: [] }], responses: { 200: { description: Health } } }
 */
platformRouter.get("/health", requirePermission("platform:health_read"), async (_req, res) => {
  res.json(await service.health());
});

/**
 * @openapi
 * /platform/audit:
 *   get: { tags: [Platform], summary: "Cross-tenant platform audit log (read-only, durable; search/filter/sort/paginate)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: q, schema: { type: string } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: actorId, schema: { type: string, format: uuid } }, { in: query, name: action, schema: { type: string } }, { in: query, name: targetType, schema: { type: string } }, { in: query, name: ip, schema: { type: string } }, { in: query, name: dateFrom, schema: { type: string } }, { in: query, name: dateTo, schema: { type: string } }, { in: query, name: page, schema: { type: integer } }, { in: query, name: pageSize, schema: { type: integer } }, { in: query, name: sort, schema: { type: string, enum: [createdAt, action, actorEmail] } }, { in: query, name: order, schema: { type: string, enum: [asc, desc] } }], responses: { 200: { description: "Paged audit { rows, total, page, pageSize }" } } }
 */
platformRouter.get("/audit", requirePermission("platform:audit_read"), async (req, res) => {
  res.json(await service.listAudit(platformAuditQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/audit/export:
 *   get: { tags: [Platform], summary: "Export the filtered audit log as CSV/XLSX", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }, { in: query, name: q, schema: { type: string } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: action, schema: { type: string } }, { in: query, name: dateFrom, schema: { type: string } }, { in: query, name: dateTo, schema: { type: string } }], responses: { 200: { description: "CSV or XLSX file of the filtered audit log" } } }
 */
platformRouter.get("/audit/export", requirePermission("platform:audit_read"), async (req, res) => {
  const q = auditExportQuerySchema.parse(req.query);
  const { columns, rows } = await service.exportAudit(q);
  await recordSecurityEvent({
    action: "platform.audit_exported",
    targetType: "platform_audit_log",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    detail: { format: q.format, rows: rows.length },
    ip: clientIp(req),
  });
  sendSpreadsheet(res, q.format, "platform-audit", columns, rows, null);
});

/**
 * @openapi
 * /platform/users:
 *   get: { tags: [Platform], summary: "Search impersonatable tenant users for the support selector (excludes super-admins)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: q, schema: { type: string } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: role, schema: { type: string } }, { in: query, name: status, schema: { type: string, enum: [active, inactive] } }, { in: query, name: limit, schema: { type: integer } }], responses: { 200: { description: Matching users (safe identity fields only) } } }
 */
platformRouter.get("/users", requirePermission("platform:impersonate"), async (req, res) => {
  res.json(await service.searchUsers(userSearchQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/impersonate:
 *   post: { tags: [Platform], summary: "Start a support impersonation session (reason required; audited; returns a scoped token + expiry, never secrets)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ impersonating, token, expiresAt, user }" }, 400: { description: Missing reason or invalid target } } }
 */
platformRouter.post("/impersonate", requirePermission("platform:impersonate"), async (req, res) => {
  res.json(await service.impersonate(impersonateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/impersonate/end:
 *   post: { tags: [Platform], summary: "End the caller's active support session(s) (audited; idempotent)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ ended }" } } }
 */
platformRouter.post("/impersonate/end", requirePermission("platform:impersonate"), async (req, res) => {
  res.json(await service.endImpersonation(actor(req)));
});

/**
 * @openapi
 * /platform/institutions:
 *   get: { tags: [Platform], summary: "List institutions with status + usage (search/filter/sort/paginate)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: q, schema: { type: string } }, { in: query, name: status, schema: { type: string, enum: [active, suspended] } }, { in: query, name: type, schema: { type: string, enum: [school, college] } }, { in: query, name: packageId, schema: { type: string, format: uuid } }, { in: query, name: createdFrom, schema: { type: string, format: date } }, { in: query, name: createdTo, schema: { type: string, format: date } }, { in: query, name: page, schema: { type: integer } }, { in: query, name: pageSize, schema: { type: integer } }, { in: query, name: sort, schema: { type: string, enum: [name, code, status, createdAt, students, staff, package] } }, { in: query, name: order, schema: { type: string, enum: [asc, desc] } }], responses: { 200: { description: "Paged institutions { rows, total, page, pageSize }" } } }
 *   post: { tags: [Platform], summary: Create an institution (audited), security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
platformRouter.get("/institutions", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.listInstitutions(listInstitutionsQuerySchema.parse(req.query)));
});
platformRouter.post("/institutions", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.status(201).json(await service.createInstitution(createInstitutionSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/institutions/export:
 *   get: { tags: [Platform], summary: "Export the filtered institution directory as CSV/XLSX", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }, { in: query, name: q, schema: { type: string } }, { in: query, name: status, schema: { type: string, enum: [active, suspended] } }, { in: query, name: type, schema: { type: string, enum: [school, college] } }], responses: { 200: { description: "CSV or XLSX file of the filtered institutions" } } }
 */
platformRouter.get("/institutions/export", requirePermission("platform:read"), async (req, res) => {
  const q = institutionExportQuerySchema.parse(req.query);
  const { columns, rows } = await service.exportInstitutions(q);
  await recordSecurityEvent({
    action: "platform.institutions_exported",
    targetType: "institution",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    detail: { format: q.format, rows: rows.length },
    ip: clientIp(req),
  });
  sendSpreadsheet(res, q.format, "institutions", columns, rows, null);
});

/**
 * @openapi
 * /platform/institutions/{id}:
 *   get: { tags: [Platform], summary: Institution detail (profile + limits + usage), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Detail }, 404: { description: Not found } } }
 *   patch: { tags: [Platform], summary: Update institution profile/type (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
platformRouter.get("/institutions/:id", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.getInstitutionDetail(uuidParam(req)));
});
platformRouter.patch("/institutions/:id", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await service.updateInstitution(uuidParam(req), updateInstitutionSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/activity:
 *   get: { tags: [Platform], summary: "Recent platform audit events for one institution (detail timeline)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Audit events, newest first } } }
 */
platformRouter.get("/institutions/:id/activity", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.institutionRecentActivity(uuidParam(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/suspend:
 *   post: { tags: [Platform], summary: Suspend an institution (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Suspended } } }
 */
platformRouter.post("/institutions/:id/suspend", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await service.suspendInstitution(uuidParam(req), suspendSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/activate:
 *   post: { tags: [Platform], summary: Activate an institution (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Activated } } }
 */
platformRouter.post("/institutions/:id/activate", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await service.activateInstitution(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/subscription:
 *   post: { tags: [Platform], summary: Assign a subscription/package (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Assigned } } }
 */
platformRouter.post("/institutions/:id/subscription", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.status(201).json(await service.assignSubscription(uuidParam(req), assignSubscriptionSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/limits:
 *   patch: { tags: [Platform], summary: Set per-institution feature limits (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated limits } } }
 */
platformRouter.patch("/institutions/:id/limits", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await service.setLimits(uuidParam(req), setLimitsSchema.parse(req.body), actor(req)));
});

// --- RBAC console ---

/**
 * @openapi
 * /platform/permissions:
 *   get: { tags: [Platform], summary: Permission catalogue grouped by module (with roles holding each), security: [{ bearerAuth: [] }], responses: { 200: { description: "[{ module, permissions: [{ key, description, roles }] }]" } } }
 */
platformRouter.get("/permissions", requirePermission("platform:permissions_read"), async (_req, res) => {
  res.json(await service.permissionCatalogue());
});

/**
 * @openapi
 * /platform/roles:
 *   get: { tags: [Platform], summary: Role → permission matrix, security: [{ bearerAuth: [] }], responses: { 200: { description: "[{ role, permissions }]" } } }
 */
platformRouter.get("/roles", requirePermission("platform:rbac_read"), async (_req, res) => {
  res.json(await service.roleMatrix());
});

/**
 * @openapi
 * /platform/roles/{role}/permissions:
 *   post: { tags: [Platform], summary: Grant a permission to a role (cache-invalidated + audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: role, required: true, schema: { type: string } }], responses: { 200: { description: Granted } } }
 */
platformRouter.post("/roles/:role/permissions", requirePermission("platform:rbac_manage"), async (req, res) => {
  const role = roleParamSchema.parse(param(req, "role"));
  const { permissionKey, reason } = grantPermissionSchema.parse(req.body);
  res.json(await service.grantRolePermission(role, permissionKey, actor(req), reason));
});

/**
 * @openapi
 * /platform/roles/{role}/permissions/revoke:
 *   post: { tags: [Platform], summary: Revoke a permission from a role (protects super_admin's platform:*; cache-invalidated + audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: role, required: true, schema: { type: string } }], responses: { 200: { description: Revoked }, 400: { description: Critical permission protected } } }
 */
platformRouter.post("/roles/:role/permissions/revoke", requirePermission("platform:rbac_manage"), async (req, res) => {
  const role = roleParamSchema.parse(param(req, "role"));
  const { permissionKey, reason } = grantPermissionSchema.parse(req.body);
  res.json(await service.revokeRolePermission(role, permissionKey, actor(req), reason));
});

// --- Email (SMTP) deliverability ---

const testEmailSchema = z.object({ to: z.string().email() });

/**
 * @openapi
 * /platform/email/status:
 *   get: { tags: [Platform], summary: SMTP configuration + connectivity status (no secrets), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ configured, ok, error? }" } } }
 */
platformRouter.get("/email/status", requirePermission("platform:health_read"), async (_req, res) => {
  res.json(await verifyMailer());
});

/**
 * @openapi
 * /platform/email/test:
 *   post: { tags: [Platform], summary: Send a test email to verify SMTP (audited), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ ok, error? }" }, 503: { description: SMTP not configured } } }
 */
platformRouter.post("/email/test", requirePermission("platform:health_read"), async (req, res) => {
  const { to } = testEmailSchema.parse(req.body);
  if (!mailerConfigured()) {
    res.status(503).json({ ok: false, error: "SMTP is not configured" });
    return;
  }
  const result = await sendTestEmail(to);
  await recordSecurityEvent({
    action: "platform.email.test",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    targetType: "email",
    detail: { to, ok: result.ok },
    ip: clientIp(req),
  });
  res.json(result);
});

// --- Subscription lifecycle (Billing Phase B1) ---

/**
 * @openapi
 * /platform/subscriptions/run-lifecycle:
 *   post: { tags: [Platform], summary: Run the subscription lifecycle sweep (expiry/grace/auto-suspend/reminders; audited), security: [{ bearerAuth: [] }], responses: { 200: { description: "Sweep summary { graceStarted, expired, trialExpired, autoSuspended, remindersSent }" } } }
 */
platformRouter.post("/subscriptions/run-lifecycle", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const a = actor(req);
  res.json(await billing.sweepSubscriptionLifecycle({ id: a.id, email: a.email }));
});

/**
 * @openapi
 * /platform/subscriptions:
 *   get: { tags: [Platform], summary: All institutions with their latest subscription status (read-only), security: [{ bearerAuth: [] }], responses: { 200: { description: "Subscription status rows, one per institution" } } }
 */
platformRouter.get("/subscriptions", requirePermission("platform:read"), async (_req, res) => {
  res.json(await billing.listAllSubscriptionStatuses());
});

/**
 * @openapi
 * /platform/subscriptions/config:
 *   get: { tags: [Platform], summary: Subscription lifecycle configuration (auto-suspend / enforcement flags + grace/reminder settings; reflects env, read-only, no secrets), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ autoSuspend, enforce, graceDays, reminderDays }" } } }
 */
platformRouter.get("/subscriptions/config", requirePermission("platform:read"), async (_req, res) => {
  res.json(billing.lifecycleConfig());
});

/**
 * @openapi
 * /platform/institutions/{id}/subscription/status:
 *   get: { tags: [Platform], summary: Current subscription status with computed isActiveNow (honours grace), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription status or null } } }
 */
platformRouter.get("/institutions/:id/subscription/status", requirePermission("platform:read"), async (req, res) => {
  res.json(await billing.subscriptionStatus(uuidParam(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/subscription/events:
 *   get: { tags: [Platform], summary: Recent subscription lifecycle audit events, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription events, newest first } } }
 */
platformRouter.get("/institutions/:id/subscription/events", requirePermission("platform:audit_read"), async (req, res) => {
  res.json(await billing.listSubscriptionEvents(uuidParam(req), 50));
});

// --- SaaS invoicing (Billing Phase B2; gateway-free, offline payment) ---

/**
 * @openapi
 * /platform/invoices:
 *   get: { tags: [Platform], summary: List SaaS invoices (paginated; status/paymentStatus/institution/overdue/date/paid-date/amount/GST/search filters + sort), security: [{ bearerAuth: [] }], parameters: [{ in: query, name: status, schema: { type: string, enum: [draft, issued, paid, void] } }, { in: query, name: paymentStatus, schema: { type: string, enum: [paid, unpaid] } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: overdue, schema: { type: boolean } }, { in: query, name: from, schema: { type: string, format: date } }, { in: query, name: to, schema: { type: string, format: date } }, { in: query, name: dueFrom, schema: { type: string, format: date } }, { in: query, name: dueTo, schema: { type: string, format: date } }, { in: query, name: paidFrom, schema: { type: string, format: date } }, { in: query, name: paidTo, schema: { type: string, format: date } }, { in: query, name: amountMin, schema: { type: number } }, { in: query, name: amountMax, schema: { type: number } }, { in: query, name: sacCode, schema: { type: string } }, { in: query, name: gstin, schema: { type: string } }, { in: query, name: placeOfSupply, schema: { type: string } }, { in: query, name: recipientState, schema: { type: string } }, { in: query, name: reverseCharge, schema: { type: string, enum: [true, false] } }, { in: query, name: q, schema: { type: string } }, { in: query, name: page, schema: { type: integer } }, { in: query, name: pageSize, schema: { type: integer } }, { in: query, name: sort, schema: { type: string, enum: [createdAt, dueDate, total, number, status] } }, { in: query, name: order, schema: { type: string, enum: [asc, desc] } }], responses: { 200: { description: "Paged invoices { rows, total, page, pageSize }" } } }
 */
platformRouter.get("/invoices", requirePermission("platform:read"), async (req, res) => {
  res.json(await invoices.listAll(listInvoicesQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/invoices/summary:
 *   get: { tags: [Platform], summary: Aggregate invoice counters across all tenants (for dashboard cards), security: [{ bearerAuth: [] }], responses: { 200: { description: "Counts + outstanding/paid/overdue amounts" } } }
 */
platformRouter.get("/invoices/summary", requirePermission("platform:read"), async (_req, res) => {
  res.json(await invoices.summary());
});

/**
 * @openapi
 * /platform/invoices/reports:
 *   get: { tags: [Platform], summary: "Invoice reports (type + date/status/institution filters); JSON or CSV/XLSX export", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: type, schema: { type: string, enum: [all, paid, unpaid, overdue, draft, void, by-institution, by-month, revenue, tax, gst] } }, { in: query, name: from, schema: { type: string, format: date } }, { in: query, name: to, schema: { type: string, format: date } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: format, schema: { type: string, enum: [json, csv, xlsx] } }], responses: { 200: { description: "Report { type, columns, rows, totals } or a spreadsheet download" } } }
 */
platformRouter.get("/invoices/reports", requirePermission("platform:read"), async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const result = await invoices.report(q);
  if (q.format === "json") {
    res.json(result);
    return;
  }
  await invoiceAudit(req, "invoice.report_exported", null, q.institutionId ?? null, {
    type: q.type,
    format: q.format,
    rows: result.rows.length,
  });
  sendSpreadsheet(res, q.format, `invoice-report-${q.type}`, result.columns, result.rows, result.totals);
});

/**
 * @openapi
 * /platform/invoices/export:
 *   get: { tags: [Platform], summary: "Export the filtered invoice list (same filters as the list, incl. paymentStatus + paid-date range) as CSV/XLSX", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }, { in: query, name: status, schema: { type: string } }, { in: query, name: paymentStatus, schema: { type: string, enum: [paid, unpaid] } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: from, schema: { type: string, format: date } }, { in: query, name: to, schema: { type: string, format: date } }, { in: query, name: paidFrom, schema: { type: string, format: date } }, { in: query, name: paidTo, schema: { type: string, format: date } }, { in: query, name: overdue, schema: { type: boolean } }], responses: { 200: { description: "CSV or XLSX file of the filtered invoices" } } }
 */
platformRouter.get("/invoices/export", requirePermission("platform:read"), async (req, res) => {
  const q = invoiceExportQuerySchema.parse(req.query);
  const { columns, rows } = await invoices.exportInvoices(q);
  await invoiceAudit(req, "invoice.exported", null, q.institutionId ?? null, {
    format: q.format,
    rows: rows.length,
  });
  sendSpreadsheet(res, q.format, "invoices", columns, rows, null);
});

/**
 * @openapi
 * /platform/invoices/{id}:
 *   get: { tags: [Platform], summary: Get a SaaS invoice with its line items, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Invoice }, 404: { description: Not found } } }
 */
platformRouter.get("/invoices/:id", requirePermission("platform:read"), async (req, res) => {
  res.json(await invoices.getInvoice(uuidParam(req)));
});

/**
 * @openapi
 * /platform/invoices/{id}/audit:
 *   get: { tags: [Platform], summary: Money-action audit timeline for an invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Audit events, newest first } } }
 */
platformRouter.get("/invoices/:id/audit", requirePermission("platform:read"), async (req, res) => {
  res.json(await invoices.getAudit(uuidParam(req)));
});

/**
 * @openapi
 * /platform/invoices/{id}/pdf:
 *   get: { tags: [Platform], summary: Download the invoice as a PDF, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "application/pdf" }, 404: { description: Not found } } }
 */
platformRouter.get("/invoices/:id/pdf", requirePermission("platform:read"), async (req, res) => {
  const id = uuidParam(req);
  const buffer = await invoices.invoicePdfBuffer(id);
  await invoiceAudit(req, "invoice.pdf_downloaded", id, null);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="invoice-${id}.pdf"`);
  res.send(buffer);
});

/**
 * @openapi
 * /platform/invoices/{id}/lines:
 *   post: { tags: [Platform], summary: Add a line item to a draft invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft } } }
 */
platformRouter.post("/invoices/:id/lines", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const inv = await invoices.addLine(uuidParam(req), invoiceLineSchema.parse(req.body));
  await invoiceAudit(req, "invoice.line_added", inv.id, inv.institutionId);
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/lines/{lineId}:
 *   patch: { tags: [Platform], summary: Edit a line item on a draft invoice (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft }, 404: { description: Line not found } } }
 */
platformRouter.patch("/invoices/:id/lines/:lineId", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const lineId = uuidParam(req, "lineId");
  const inv = await invoices.updateLine(uuidParam(req), lineId, updateLineSchema.parse(req.body));
  await invoiceAudit(req, "invoice.line_edited", inv.id, inv.institutionId, { lineId });
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}:
 *   patch: { tags: [Platform], summary: Edit a draft invoice's header (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft } } }
 *   delete: { tags: [Platform], summary: Delete a draft invoice permanently (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Deleted }, 400: { description: Not a draft } } }
 */
platformRouter.patch("/invoices/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const body = updateInvoiceSchema.parse(req.body);
  const inv = await invoices.updateDraft(uuidParam(req), body);
  await invoiceAudit(req, "invoice.draft_edited", inv.id, inv.institutionId, {
    fields: Object.keys(body),
  });
  res.json(inv);
});
platformRouter.delete("/invoices/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const id = uuidParam(req);
  const result = await invoices.deleteDraft(id);
  await invoiceAudit(req, "invoice.deleted", id, null);
  res.json(result);
});

/**
 * @openapi
 * /platform/invoices/{id}/lines/{lineId}:
 *   delete: { tags: [Platform], summary: Remove a line item from a draft invoice (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft }, 404: { description: Line not found } } }
 */
platformRouter.delete("/invoices/:id/lines/:lineId", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const lineId = uuidParam(req, "lineId");
  const inv = await invoices.removeLine(uuidParam(req), lineId);
  await invoiceAudit(req, "invoice.line_removed", inv.id, inv.institutionId, { lineId });
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/issue:
 *   post: { tags: [Platform], summary: Issue a draft invoice (assigns a sequential number), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Issued invoice }, 400: { description: Not a draft } } }
 */
platformRouter.post("/invoices/:id/issue", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const inv = await invoices.issueInvoice(uuidParam(req), req.user!.id);
  await invoiceAudit(req, "invoice.issued", inv.id, inv.institutionId, {
    number: inv.number,
    total: inv.total,
  });
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/coupon:
 *   post: { tags: [Platform], summary: Apply a coupon to a draft invoice (validated; pre-tax discount; audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated draft }, 400: { description: Invalid/inapplicable coupon or not a draft } } }
 *   delete: { tags: [Platform], summary: Remove the coupon from a draft invoice (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated draft } } }
 */
platformRouter.post("/invoices/:id/coupon", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const { code } = applyCouponSchema.parse(req.body);
  const inv = await invoices.applyCoupon(uuidParam(req), code);
  await invoiceAudit(req, "invoice.coupon_applied", inv.id, inv.institutionId, {
    coupon: inv.couponCode, discount: inv.discountAmount,
  });
  res.json(inv);
});
platformRouter.delete("/invoices/:id/coupon", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const inv = await invoices.removeCoupon(uuidParam(req));
  await invoiceAudit(req, "invoice.coupon_removed", inv.id, inv.institutionId, {});
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/mark-paid:
 *   post: { tags: [Platform], summary: Record OFFLINE payment for an issued invoice (no gateway), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Paid invoice }, 400: { description: Not issued } } }
 */
platformRouter.post("/invoices/:id/mark-paid", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const body = markPaidSchema.parse(req.body);
  const inv = await invoices.markPaid(uuidParam(req), body, req.user!.id);
  await invoiceAudit(req, "invoice.paid", inv.id, inv.institutionId, {
    method: body.paymentMethod,
    reference: body.reference ?? null,
    total: inv.total,
  });
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/void:
 *   post: { tags: [Platform], summary: Void a draft or issued invoice with a required reason (a paid invoice cannot be voided), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], requestBody: { required: true, content: { application/json: { schema: { type: object, required: [reason], properties: { reason: { type: string } } } } } }, responses: { 200: { description: Voided invoice }, 400: { description: Paid invoice or missing reason } } }
 */
platformRouter.post("/invoices/:id/void", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const { reason } = voidInvoiceSchema.parse(req.body);
  const inv = await invoices.voidInvoice(uuidParam(req), reason, req.user!.id);
  await invoiceAudit(req, "invoice.voided", inv.id, inv.institutionId, { reason });
  res.json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/duplicate:
 *   post: { tags: [Platform], summary: Clone an invoice into a fresh draft (header + lines), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: New draft invoice }, 404: { description: Not found } } }
 */
platformRouter.post("/invoices/:id/duplicate", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const inv = await invoices.duplicateInvoice(uuidParam(req), req.user!.id);
  await invoiceAudit(req, "invoice.duplicated", inv.id, inv.institutionId, {
    sourceId: uuidParam(req),
  });
  res.status(201).json(inv);
});

/**
 * @openapi
 * /platform/invoices/{id}/resend:
 *   post: { tags: [Platform], summary: Re-send the invoice email to the tenant's admins (issued or paid), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ recipients } emailed (best-effort)" }, 400: { description: Not issued or paid } } }
 */
platformRouter.post("/invoices/:id/resend", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const id = uuidParam(req);
  const result = await invoices.resendInvoice(id, req.user!.id);
  await invoiceAudit(req, "invoice.resent", id, null, { recipients: result.recipients });
  res.json(result);
});

/**
 * @openapi
 * /platform/invoice-settings:
 *   get: { tags: [Platform], summary: Get platform invoice settings (supplier profile, numbering, defaults, bank/PDF), security: [{ bearerAuth: [] }], responses: { 200: { description: Settings } } }
 *   patch: { tags: [Platform], summary: Update platform invoice settings, security: [{ bearerAuth: [] }], responses: { 200: { description: Updated settings } } }
 */
platformRouter.get("/invoice-settings", requirePermission("platform:read"), async (_req, res) => {
  res.json(await invoiceSettings.getSettings());
});
platformRouter.patch("/invoice-settings", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const body = invoiceSettingsSchema.parse(req.body);
  const updated = await invoiceSettings.updateSettings(body, req.user!.id);
  await invoiceAudit(req, "invoice.settings_changed", null, null, {
    fields: Object.keys(body),
  }, "invoice_settings");
  res.json(updated);
});

/**
 * @openapi
 * /platform/institutions/{id}/invoices:
 *   get: { tags: [Platform], summary: List a tenant's SaaS invoices, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: status, schema: { type: string } }], responses: { 200: { description: Invoices } } }
 *   post: { tags: [Platform], summary: Create a draft SaaS invoice for a tenant, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Draft invoice } } }
 */
platformRouter.get("/institutions/:id/invoices", requirePermission("platform:read"), async (req, res) => {
  const { status } = institutionInvoicesQuerySchema.parse(req.query);
  res.json(await invoices.listForInstitution(uuidParam(req), status));
});
platformRouter.post("/institutions/:id/invoices", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const inv = await invoices.createDraft(
    uuidParam(req),
    createInvoiceSchema.parse(req.body),
    req.user!.id
  );
  await invoiceAudit(req, "invoice.created", inv.id, inv.institutionId, {
    total: inv.total,
  });
  res.status(201).json(inv);
});

// ---- P2: Credit & Debit notes (standalone documents linked to an invoice) ----

const noteAudit = (
  req: Request,
  action: string,
  targetId: string | null,
  institutionId: string | null,
  detail: Record<string, unknown> = {}
) => invoiceAudit(req, action, targetId, institutionId, detail, "saas_invoice_note");

/**
 * @openapi
 * /platform/invoices/{id}/notes:
 *   get: { tags: [Platform], summary: List credit/debit notes for an invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: kind, schema: { type: string, enum: [credit, debit] } }, { in: query, name: status, schema: { type: string, enum: [draft, issued, void] } }], responses: { 200: { description: Notes, newest first } } }
 *   post: { tags: [Platform], summary: "Create a draft credit/debit note against an issued/paid invoice", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], requestBody: { required: true, content: { application/json: { schema: { type: object, required: [kind], properties: { kind: { type: string, enum: [credit, debit] } } } } } }, responses: { 201: { description: Draft note }, 400: { description: Invoice not issued/paid }, 404: { description: Invoice not found } } }
 */
platformRouter.get("/invoices/:id/notes", requirePermission("platform:read"), async (req, res) => {
  res.json(await notes.listForInvoice(uuidParam(req), noteListQuerySchema.parse(req.query)));
});
platformRouter.post("/invoices/:id/notes", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const note = await notes.createNote(uuidParam(req), createNoteSchema.parse(req.body), req.user!.id);
  await noteAudit(req, "note.created", note.id, note.institutionId, {
    kind: note.kind,
    invoiceId: note.invoiceId,
  });
  res.status(201).json(note);
});

/**
 * @openapi
 * /platform/notes/{id}:
 *   get: { tags: [Platform], summary: Get a credit/debit note with its line items and linked invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Note }, 404: { description: Not found } } }
 *   patch: { tags: [Platform], summary: Edit a draft note's header (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated note }, 400: { description: Not a draft } } }
 *   delete: { tags: [Platform], summary: Delete a draft note permanently (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Deleted }, 400: { description: Not a draft } } }
 */
platformRouter.get("/notes/:id", requirePermission("platform:read"), async (req, res) => {
  res.json(await notes.getNote(uuidParam(req)));
});
platformRouter.patch("/notes/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const body = updateNoteSchema.parse(req.body);
  const note = await notes.updateNote(uuidParam(req), body);
  await noteAudit(req, "note.draft_edited", note.id, note.institutionId, {
    fields: Object.keys(body),
  });
  res.json(note);
});
platformRouter.delete("/notes/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const id = uuidParam(req);
  const result = await notes.deleteNote(id);
  await noteAudit(req, "note.deleted", id, null);
  res.json(result);
});

/**
 * @openapi
 * /platform/notes/{id}/audit:
 *   get: { tags: [Platform], summary: Money-action audit timeline for a note, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Audit events, newest first } } }
 */
platformRouter.get("/notes/:id/audit", requirePermission("platform:read"), async (req, res) => {
  res.json(await notes.getNoteAudit(uuidParam(req)));
});

/**
 * @openapi
 * /platform/notes/{id}/pdf:
 *   get: { tags: [Platform], summary: Download the credit/debit note as a PDF, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "application/pdf" }, 404: { description: Not found } } }
 */
platformRouter.get("/notes/:id/pdf", requirePermission("platform:read"), async (req, res) => {
  const id = uuidParam(req);
  const buffer = await notes.notePdfBuffer(id);
  await noteAudit(req, "note.pdf_downloaded", id, null);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="note-${id}.pdf"`);
  res.send(buffer);
});

/**
 * @openapi
 * /platform/notes/{id}/lines:
 *   post: { tags: [Platform], summary: Add a line item to a draft note, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated note }, 400: { description: Not a draft } } }
 */
platformRouter.post("/notes/:id/lines", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const note = await notes.addNoteLine(uuidParam(req), noteLineSchema.parse(req.body));
  await noteAudit(req, "note.line_added", note.id, note.institutionId);
  res.json(note);
});

/**
 * @openapi
 * /platform/notes/{id}/lines/{lineId}:
 *   patch: { tags: [Platform], summary: Edit a line item on a draft note (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated note }, 400: { description: Not a draft }, 404: { description: Line not found } } }
 *   delete: { tags: [Platform], summary: Remove a line item from a draft note (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated note }, 400: { description: Not a draft }, 404: { description: Line not found } } }
 */
platformRouter.patch("/notes/:id/lines/:lineId", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const lineId = uuidParam(req, "lineId");
  const note = await notes.updateNoteLine(uuidParam(req), lineId, updateNoteLineSchema.parse(req.body));
  await noteAudit(req, "note.line_edited", note.id, note.institutionId, { lineId });
  res.json(note);
});
platformRouter.delete("/notes/:id/lines/:lineId", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const lineId = uuidParam(req, "lineId");
  const note = await notes.removeNoteLine(uuidParam(req), lineId);
  await noteAudit(req, "note.line_removed", note.id, note.institutionId, { lineId });
  res.json(note);
});

/**
 * @openapi
 * /platform/notes/{id}/issue:
 *   post: { tags: [Platform], summary: "Issue a draft note (assigns a continuous, per-kind number)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Issued note }, 400: { description: Not a draft } } }
 */
platformRouter.post("/notes/:id/issue", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const note = await notes.issueNote(uuidParam(req), req.user!.id);
  await noteAudit(req, "note.issued", note.id, note.institutionId, {
    number: note.number,
    kind: note.kind,
    total: note.total,
  });
  res.json(note);
});

/**
 * @openapi
 * /platform/notes/{id}/void:
 *   post: { tags: [Platform], summary: Void a draft or issued note with a required reason, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], requestBody: { required: true, content: { application/json: { schema: { type: object, required: [reason], properties: { reason: { type: string } } } } } }, responses: { 200: { description: Voided note }, 400: { description: Missing reason } } }
 */
platformRouter.post("/notes/:id/void", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  const { reason } = voidNoteSchema.parse(req.body);
  const note = await notes.voidNote(uuidParam(req), reason, req.user!.id);
  await noteAudit(req, "note.voided", note.id, note.institutionId, { reason });
  res.json(note);
});
