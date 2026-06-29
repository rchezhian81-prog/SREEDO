import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { uploadSingle } from "../../utils/upload";
import { ApiError } from "../../utils/api-error";
import * as tenants from "./tenant.service";
import {
  brandingSchema,
  complianceSchema,
  completeOnboardingSchema,
  createTenantSchema,
  crmSchema,
  documentMetaSchema,
  documentVerifySchema,
  LIFECYCLE_STATUSES,
  noteSchema,
  onboardingStepSchema,
  primaryAdminSchema,
  settingsSchema,
  tenantExportQuerySchema,
  tenantListQuerySchema,
  updateNoteSchema,
  updateTenantSchema,
} from "./tenant.schema";

/**
 * Tenant / Institution Management — one common, type-driven module. Super-admin
 * only (the platform sits above any tenant). Sensitive actions are audited in the
 * service via platform_audit_log; no tenant is ever hard-deleted.
 */
export const tenantRouter = Router();
tenantRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

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

const lifecycleSchema = z.object({
  status: z.enum(LIFECYCLE_STATUSES),
  reason: z.string().trim().max(500).optional(),
});
const adminActiveSchema = z.object({ active: z.boolean() });

/**
 * @openapi
 * /platform/tenants:
 *   get: { tags: [Platform], summary: "List tenants (search/filter by type+status, paginate, sort)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: q, schema: { type: string } }, { in: query, name: institutionType, schema: { type: string, enum: [school, college, university, coaching, other] } }, { in: query, name: status, schema: { type: string, enum: [draft, trial, active, suspended, expired, archived] } }, { in: query, name: page, schema: { type: integer } }, { in: query, name: pageSize, schema: { type: integer } }, { in: query, name: sort, schema: { type: string } }, { in: query, name: order, schema: { type: string, enum: [asc, desc] } }], responses: { 200: { description: "Paged tenants { rows, total, page, pageSize }" } } }
 *   post: { tags: [Platform], summary: "Create a tenant (any institution_type; optional primary admin; starts in draft/onboarding)", security: [{ bearerAuth: [] }], responses: { 201: { description: Created tenant }, 409: { description: Code/email exists } } }
 */
tenantRouter.get("/tenants", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.listTenants(tenantListQuerySchema.parse(req.query)));
});
tenantRouter.post("/tenants", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.status(201).json(await tenants.createTenant(createTenantSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/export:
 *   get: { tags: [Platform], summary: "Export the filtered tenant directory as CSV/XLSX", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }], responses: { 200: { description: CSV/XLSX file } } }
 */
tenantRouter.get("/tenants/export", requirePermission("platform:read"), async (req, res) => {
  const q = tenantExportQuerySchema.parse(req.query);
  const { columns, rows } = await tenants.exportTenants(q);
  sendSpreadsheet(res, q.format, "tenants", columns, rows);
});

/**
 * @openapi
 * /platform/tenants/notes/{noteId}:
 *   patch: { tags: [Platform], summary: "Edit an internal tenant note", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: noteId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 *   delete: { tags: [Platform], summary: "Delete an internal tenant note", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: noteId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 */
tenantRouter.patch("/tenants/notes/:noteId", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.updateNote(uuidParam(req, "noteId"), updateNoteSchema.parse(req.body), actor(req)));
});
tenantRouter.delete("/tenants/notes/:noteId", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.deleteNote(uuidParam(req, "noteId"), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}:
 *   get: { tags: [Platform], summary: "Full tenant detail (profile, type, settings, limits, usage, billing, onboarding, compliance, admins, recent activity)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant }, 404: { description: Not found } } }
 *   patch: { tags: [Platform], summary: "Update tenant profile / institution_type", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.get("/tenants/:id", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.getTenant(uuidParam(req)));
});
tenantRouter.patch("/tenants/:id", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.updateTenant(uuidParam(req), updateTenantSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/billing:
 *   get: { tags: [Platform], summary: "Read-only billing summary for a tenant (latest invoice, outstanding, overdue, subscription)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Billing summary } } }
 */
tenantRouter.get("/tenants/:id/billing", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.tenantBilling(uuidParam(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/lifecycle:
 *   post: { tags: [Platform], summary: "Transition tenant lifecycle status (suspend/archive require a reason; is_active kept in sync)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], requestBody: { required: true, content: { application/json: { schema: { type: object, required: [status], properties: { status: { type: string, enum: [draft, trial, active, suspended, expired, archived] }, reason: { type: string } } } } } }, responses: { 200: { description: Tenant }, 400: { description: Reason required } } }
 */
tenantRouter.post("/tenants/:id/lifecycle", requirePermission("platform:manage_institutions"), async (req, res) => {
  const { status, reason } = lifecycleSchema.parse(req.body);
  res.json(await tenants.setLifecycle(uuidParam(req), status, reason, actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/settings:
 *   patch: { tags: [Platform], summary: "Update type-based settings (academicStructure, enabledModules, school/college settings, communication)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.patch("/tenants/:id/settings", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.updateSettings(uuidParam(req), settingsSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/onboarding/step:
 *   post: { tags: [Platform], summary: "Mark an onboarding checklist step done/undone", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 * /platform/tenants/{id}/onboarding/complete:
 *   post: { tags: [Platform], summary: "Complete onboarding (activates a draft tenant)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.post("/tenants/:id/onboarding/step", requirePermission("platform:manage_institutions"), async (req, res) => {
  const { step, done } = onboardingStepSchema.parse(req.body);
  res.json(await tenants.setOnboardingStep(uuidParam(req), step, done, actor(req)));
});
tenantRouter.post("/tenants/:id/onboarding/complete", requirePermission("platform:manage_institutions"), async (req, res) => {
  const parsed = completeOnboardingSchema.parse(req.body);
  res.json(await tenants.completeOnboarding(uuidParam(req), parsed?.override === true, actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/compliance:
 *   patch: { tags: [Platform], summary: "Update compliance/approval (terms, agreement, KYC, approval status + remarks)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.patch("/tenants/:id/compliance", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.setCompliance(uuidParam(req), complianceSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/admin:
 *   post: { tags: [Platform], summary: "Create/assign a primary tenant admin (secure random password; no default exposed)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant }, 409: { description: Email exists } } }
 */
tenantRouter.post("/tenants/:id/admin", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.setPrimaryAdmin(uuidParam(req), primaryAdminSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/admin/{userId}:
 *   patch: { tags: [Platform], summary: "Enable/disable a tenant admin user", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: userId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.patch("/tenants/:id/admin/:userId", requirePermission("platform:manage_institutions"), async (req, res) => {
  const { active } = adminActiveSchema.parse(req.body);
  res.json(await tenants.setAdminActive(uuidParam(req), uuidParam(req, "userId"), active, actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/notes:
 *   get: { tags: [Platform], summary: "Internal CRM notes for a tenant (super-admin only)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 *   post: { tags: [Platform], summary: "Add an internal CRM note", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 */
tenantRouter.get("/tenants/:id/notes", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.listNotes(uuidParam(req)));
});
tenantRouter.post("/tenants/:id/notes", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.addNote(uuidParam(req), noteSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/crm:
 *   patch: { tags: [Platform], summary: "Update CRM fields (account manager, last contacted)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 * /platform/tenants/{id}/branding:
 *   patch: { tags: [Platform], summary: "Update tenant branding (display name, logo URL, colour, tagline)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Tenant } } }
 */
tenantRouter.patch("/tenants/:id/crm", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.updateCrm(uuidParam(req), crmSchema.parse(req.body), actor(req)));
});
tenantRouter.patch("/tenants/:id/branding", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.updateBranding(uuidParam(req), brandingSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/admin/{userId}/reset-link:
 *   post: { tags: [Platform], summary: "Email a password-setup / reset link to a tenant admin (no-op if SMTP off)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: userId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ emailSent }" } } }
 */
tenantRouter.post("/tenants/:id/admin/:userId/reset-link", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.sendAdminSetupLink(uuidParam(req), uuidParam(req, "userId"), actor(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/health:
 *   get: { tags: [Platform], summary: "Per-tenant health/usage dashboard (real metrics only)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Health snapshot } } }
 */
tenantRouter.get("/tenants/:id/health", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.tenantHealth(uuidParam(req)));
});

/**
 * @openapi
 * /platform/tenants/{id}/export:
 *   get: { tags: [Platform], summary: "Export a tenant's basic profile (CSV/XLSX)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }], responses: { 200: { description: File } } }
 * /platform/tenants/{id}/users/export:
 *   get: { tags: [Platform], summary: "Export a tenant's users list (CSV/XLSX)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }], responses: { 200: { description: File } } }
 */
tenantRouter.get("/tenants/:id/export", requirePermission("platform:read"), async (req, res) => {
  const fmt = req.query.format === "xlsx" ? "xlsx" : "csv";
  const { columns, rows } = await tenants.exportTenantProfile(uuidParam(req));
  sendSpreadsheet(res, fmt, "tenant-profile", columns, rows);
});
tenantRouter.get("/tenants/:id/users/export", requirePermission("platform:read"), async (req, res) => {
  const fmt = req.query.format === "xlsx" ? "xlsx" : "csv";
  const { columns, rows } = await tenants.exportTenantUsers(uuidParam(req));
  sendSpreadsheet(res, fmt, "tenant-users", columns, rows);
});

/**
 * @openapi
 * /platform/tenants/{id}/documents:
 *   get: { tags: [Platform], summary: "List a tenant's documents", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Documents } } }
 *   post: { tags: [Platform], summary: "Upload a tenant document (multipart: file + category)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Documents }, 400: { description: Invalid file } } }
 */
tenantRouter.get("/tenants/:id/documents", requirePermission("platform:read"), async (req, res) => {
  res.json(await tenants.listDocuments(uuidParam(req)));
});
tenantRouter.post(
  "/tenants/:id/documents",
  requirePermission("platform:manage_institutions"),
  uploadSingle("file"),
  async (req, res) => {
    const id = uuidParam(req);
    const { category } = documentMetaSchema.parse(req.body);
    const file = req.file;
    if (!file) throw ApiError.badRequest("A file is required (multipart field 'file')");
    res.json(await tenants.addDocument(id, category, file, actor(req)));
  }
);

/**
 * @openapi
 * /platform/tenants/{id}/documents/{docId}/download:
 *   get: { tags: [Platform], summary: "Download a tenant document", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: docId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: File bytes } } }
 * /platform/tenants/{id}/documents/{docId}/verify:
 *   patch: { tags: [Platform], summary: "Set a document's verification status + remarks", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: docId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Documents } } }
 * /platform/tenants/{id}/documents/{docId}/archive:
 *   post: { tags: [Platform], summary: "Soft-archive a document (file retained)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: docId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Documents } } }
 * /platform/tenants/{id}/documents/{docId}:
 *   delete: { tags: [Platform], summary: "Delete a single document (file + row; not the tenant)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: docId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Documents } } }
 */
tenantRouter.get("/tenants/:id/documents/:docId/download", requirePermission("platform:read"), async (req, res) => {
  const { buffer, mimeType, originalName } = await tenants.getDocumentForDownload(uuidParam(req), uuidParam(req, "docId"));
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${originalName.replace(/[^\w.\- ]/g, "_")}"`);
  res.send(buffer);
});
tenantRouter.patch("/tenants/:id/documents/:docId/verify", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.verifyDocument(uuidParam(req), uuidParam(req, "docId"), documentVerifySchema.parse(req.body), actor(req)));
});
tenantRouter.post("/tenants/:id/documents/:docId/archive", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.archiveDocument(uuidParam(req), uuidParam(req, "docId"), actor(req)));
});
tenantRouter.delete("/tenants/:id/documents/:docId", requirePermission("platform:manage_institutions"), async (req, res) => {
  res.json(await tenants.deleteDocument(uuidParam(req), uuidParam(req, "docId"), actor(req)));
});
