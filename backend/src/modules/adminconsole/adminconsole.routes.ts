import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { auditQuerySchema, updateSettingsSchema } from "./adminconsole.schema";
import * as service from "./adminconsole.service";

// The entire admin console is super-admin-only (platform controls above any one
// institution). No normal admin/staff/student/parent can reach these routes.
export const adminConsoleRouter = Router();
adminConsoleRouter.use(authenticate, authorize("super_admin"));

/**
 * @openapi
 * /admin/institutions:
 *   get:
 *     tags: [Admin Console]
 *     summary: List institutions (brief — for settings/limits/switch)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Institutions } }
 */
adminConsoleRouter.get("/institutions", async (_req, res) => {
  res.json(await service.listInstitutionsBrief());
});

/**
 * @openapi
 * /admin/institutions/{id}/settings:
 *   get:
 *     tags: [Admin Console]
 *     summary: Get an institution's global settings (incl. feature flags, modules)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Settings }, 404: { description: Not found } }
 *   patch:
 *     tags: [Admin Console]
 *     summary: Update institution settings (name/type/status/contact/modules/flags)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [school, college] }
 *               isActive: { type: boolean }
 *               contact: { type: object }
 *               enabledModules: { type: array, items: { type: string } }
 *               featureFlags: { type: object, additionalProperties: { type: boolean } }
 *               academicYearDefaults: { type: object }
 *     responses: { 200: { description: Updated settings } }
 */
adminConsoleRouter.get("/institutions/:id/settings", async (req, res) => {
  res.json(await service.getInstitutionSettings(uuidParam(req)));
});
adminConsoleRouter.patch("/institutions/:id/settings", async (req, res) => {
  res.json(await service.updateInstitutionSettings(uuidParam(req), updateSettingsSchema.parse(req.body)));
});

/**
 * @openapi
 * /admin/institutions/{id}/limits:
 *   get:
 *     tags: [Admin Console]
 *     summary: Plan feature limits + current usage for an institution
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "{ packageName, maxStudents, students, maxStaff, staff, withinLimits }" } }
 */
adminConsoleRouter.get("/institutions/:id/limits", async (req, res) => {
  res.json(await service.institutionLimits(uuidParam(req)));
});

/**
 * @openapi
 * /admin/institutions/{id}/stats:
 *   get:
 *     tags: [Admin Console]
 *     summary: Read-only tenant snapshot (the cross-tenant switch view)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Tenant KPIs } }
 */
adminConsoleRouter.get("/institutions/:id/stats", async (req, res) => {
  res.json(await service.institutionStats(uuidParam(req)));
});

/**
 * @openapi
 * /admin/institutions/{id}/export:
 *   post:
 *     tags: [Admin Console]
 *     summary: Generate a safe data export summary (counts + metadata; no secrets)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Export record (with summary) } }
 */
adminConsoleRouter.post("/institutions/:id/export", async (req, res) => {
  res.json(await service.createExport(uuidParam(req), req.user!.id));
});

/**
 * @openapi
 * /admin/exports:
 *   get:
 *     tags: [Admin Console]
 *     summary: Data-export history (optionally for one institution)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: institutionId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Export history } }
 */
adminConsoleRouter.get("/exports", async (req, res) => {
  const institutionId = typeof req.query.institutionId === "string" ? req.query.institutionId : undefined;
  res.json(await service.listExports(institutionId));
});

/**
 * @openapi
 * /admin/audit-logs:
 *   get:
 *     tags: [Admin Console]
 *     summary: Global audit log viewer (filters; reads MongoDB, degrades gracefully)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: institutionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: userId, schema: { type: string, format: uuid } }
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string, example: POST } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses: { 200: { description: "{ available, rows }" } }
 */
adminConsoleRouter.get("/audit-logs", async (req, res) => {
  res.json(await service.listAuditLogs(auditQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /admin/audit-logs/export:
 *   get:
 *     tags: [Admin Console]
 *     summary: Export filtered audit logs as CSV
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: CSV file, content: { text/csv: {} } } }
 */
adminConsoleRouter.get("/audit-logs/export", async (req, res) => {
  const csv = await service.auditLogsCsv(auditQuerySchema.parse(req.query));
  res.type("text/csv").attachment("audit-logs.csv").send(csv);
});

/**
 * @openapi
 * /admin/system/health:
 *   get:
 *     tags: [Admin Console]
 *     summary: System health/status summary (DB, Mongo, counts, uptime)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Health summary } }
 */
adminConsoleRouter.get("/system/health", async (_req, res) => {
  res.json(await service.systemHealth());
});
