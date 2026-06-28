import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { param, uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { mailerConfigured, sendTestEmail, verifyMailer } from "../../utils/mailer";
import { clientIp, recordSecurityEvent } from "../../utils/security-audit";
import {
  assignSubscriptionSchema,
  createInstitutionSchema,
  grantPermissionSchema,
  impersonateSchema,
  platformAuditQuerySchema,
  roleParamSchema,
  setLimitsSchema,
  suspendSchema,
  updateInstitutionSchema,
} from "./platform.schema";
import * as service from "./platform.service";
import * as billing from "../billing/billing.service";
import * as invoices from "../billing/invoices.service";
import {
  createInvoiceSchema,
  invoiceLineSchema,
  listInvoicesQuerySchema,
  markPaidSchema,
  updateInvoiceSchema,
} from "../billing/invoices.schema";

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
 *   get: { tags: [Platform], summary: Cross-tenant platform audit log (read-only; durable), security: [{ bearerAuth: [] }], parameters: [{ in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: actorId, schema: { type: string, format: uuid } }, { in: query, name: action, schema: { type: string } }, { in: query, name: targetType, schema: { type: string } }, { in: query, name: dateFrom, schema: { type: string } }, { in: query, name: dateTo, schema: { type: string } }], responses: { 200: { description: Audit rows } } }
 */
platformRouter.get("/audit", requirePermission("platform:audit_read"), async (req, res) => {
  res.json(await service.listAudit(platformAuditQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/impersonate:
 *   post: { tags: [Platform], summary: Start a support impersonation session (audited; returns a scoped token, never secrets), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ impersonating, token, user }" } } }
 */
platformRouter.post("/impersonate", requirePermission("platform:impersonate"), async (req, res) => {
  res.json(await service.impersonate(impersonateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/institutions:
 *   get: { tags: [Platform], summary: List institutions with status + usage, security: [{ bearerAuth: [] }], responses: { 200: { description: Institutions } } }
 *   post: { tags: [Platform], summary: Create an institution (audited), security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
platformRouter.get("/institutions", requirePermission("platform:read"), async (_req, res) => {
  res.json(await service.listInstitutions());
});
platformRouter.post("/institutions", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.status(201).json(await service.createInstitution(createInstitutionSchema.parse(req.body), actor(req)));
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
 *   get: { tags: [Platform], summary: List all SaaS invoices (optional status filter), security: [{ bearerAuth: [] }], parameters: [{ in: query, name: status, schema: { type: string, enum: [draft, issued, paid, void] } }], responses: { 200: { description: Invoices, newest first } } }
 */
platformRouter.get("/invoices", requirePermission("platform:read"), async (req, res) => {
  const { status } = listInvoicesQuerySchema.parse(req.query);
  res.json(await invoices.listAll(status));
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
 * /platform/invoices/{id}/pdf:
 *   get: { tags: [Platform], summary: Download the invoice as a PDF, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "application/pdf" }, 404: { description: Not found } } }
 */
platformRouter.get("/invoices/:id/pdf", requirePermission("platform:read"), async (req, res) => {
  const id = uuidParam(req);
  const buffer = await invoices.invoicePdfBuffer(id);
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
  res.json(await invoices.addLine(uuidParam(req), invoiceLineSchema.parse(req.body)));
});

/**
 * @openapi
 * /platform/invoices/{id}:
 *   patch: { tags: [Platform], summary: Edit a draft invoice's header (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft } } }
 */
platformRouter.patch("/invoices/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await invoices.updateDraft(uuidParam(req), updateInvoiceSchema.parse(req.body)));
});

/**
 * @openapi
 * /platform/invoices/{id}/lines/{lineId}:
 *   delete: { tags: [Platform], summary: Remove a line item from a draft invoice (draft only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated invoice }, 400: { description: Not a draft }, 404: { description: Line not found } } }
 */
platformRouter.delete("/invoices/:id/lines/:lineId", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await invoices.removeLine(uuidParam(req), uuidParam(req, "lineId")));
});

/**
 * @openapi
 * /platform/invoices/{id}/issue:
 *   post: { tags: [Platform], summary: Issue a draft invoice (assigns a sequential number), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Issued invoice }, 400: { description: Not a draft } } }
 */
platformRouter.post("/invoices/:id/issue", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await invoices.issueInvoice(uuidParam(req)));
});

/**
 * @openapi
 * /platform/invoices/{id}/mark-paid:
 *   post: { tags: [Platform], summary: Record OFFLINE payment for an issued invoice (no gateway), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Paid invoice }, 400: { description: Not issued } } }
 */
platformRouter.post("/invoices/:id/mark-paid", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await invoices.markPaid(uuidParam(req), markPaidSchema.parse(req.body)));
});

/**
 * @openapi
 * /platform/invoices/{id}/void:
 *   post: { tags: [Platform], summary: Void a draft or issued invoice (a paid invoice cannot be voided), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Voided invoice }, 400: { description: Paid invoice } } }
 */
platformRouter.post("/invoices/:id/void", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await invoices.voidInvoice(uuidParam(req)));
});

/**
 * @openapi
 * /platform/institutions/{id}/invoices:
 *   get: { tags: [Platform], summary: List a tenant's SaaS invoices, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: status, schema: { type: string } }], responses: { 200: { description: Invoices } } }
 *   post: { tags: [Platform], summary: Create a draft SaaS invoice for a tenant, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Draft invoice } } }
 */
platformRouter.get("/institutions/:id/invoices", requirePermission("platform:read"), async (req, res) => {
  const { status } = listInvoicesQuerySchema.parse(req.query);
  res.json(await invoices.listForInstitution(uuidParam(req), status));
});
platformRouter.post("/institutions/:id/invoices", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.status(201).json(
    await invoices.createDraft(uuidParam(req), createInvoiceSchema.parse(req.body), req.user!.id)
  );
});
