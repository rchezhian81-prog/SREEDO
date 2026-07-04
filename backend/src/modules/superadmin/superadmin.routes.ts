import { Router, type Request, type Response } from "express";
import { uuidParam } from "../../utils/params";
import { ApiError } from "../../utils/api-error";
import { authenticate, authorize } from "../../middleware/auth";
import { platformIpGate } from "../../middleware/platform-ip-gate";
import { requirePermission } from "../../middleware/permissions";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import {
  assignSubscriptionSchema,
  createBranchSchema,
  createInstitutionSchema,
  createPackageSchema,
  duplicatePackageSchema,
  packageCompareQuerySchema,
  packageExportQuerySchema,
  packageListQuerySchema,
  packageStatusSchema,
  packageUsageQuerySchema,
  updateBranchSchema,
  updateInstitutionSchema,
  updatePackageSchema,
} from "./superadmin.schema";
import * as service from "./superadmin.service";

// Everything here is super-admin-only: managing tenants sits above any one
// institution's admin.
export const superAdminRouter = Router();
superAdminRouter.use(authenticate, authorize("super_admin"));
// Platform IP allowlist (no-op unless an operator enabled a non-empty list).
superAdminRouter.use(platformIpGate);
// RBAC (Super Admin H): every route needs platform:read; mutations additionally
// need the relevant manage key, so a read-only platform sub-role (e.g. auditor)
// can view but not mutate. Owners bypass (see requirePermission).
superAdminRouter.use(requirePermission("platform:read"));
const canManageTenant = requirePermission("platform:manage_institutions");
const canManageBilling = requirePermission("platform:manage_subscriptions");

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

const PACKAGE_LIST_COLUMNS = [
  { key: "name", label: "Name" }, { key: "status", label: "Status" },
  { key: "visibility", label: "Visibility" }, { key: "price", label: "Price" },
  { key: "currency", label: "Currency" }, { key: "billingCycle", label: "Billing" },
  { key: "maxStudents", label: "Max students" }, { key: "maxStaff", label: "Max staff" },
  { key: "isTrial", label: "Trial" }, { key: "displayOrder", label: "Order" },
  { key: "createdAt", label: "Created" },
];

/**
 * @openapi
 * /institutions:
 *   get:
 *     tags: [Super Admin]
 *     summary: List institutions (super admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Institutions with branch counts }
 *   post:
 *     tags: [Super Admin]
 *     summary: Create an institution (super admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string, example: SREDEMO }
 *               type: { type: string, enum: [school, college] }
 *               settings: { type: object }
 *     responses:
 *       201: { description: Created institution }
 *       409: { description: Code already in use }
 */
superAdminRouter.get("/institutions", async (_req, res) => {
  res.json(await service.listInstitutions());
});

superAdminRouter.post("/institutions", canManageTenant, async (req, res) => {
  const input = createInstitutionSchema.parse(req.body);
  res.status(201).json(await service.createInstitution(input));
});

/**
 * @openapi
 * /institutions/{id}:
 *   get:
 *     tags: [Super Admin]
 *     summary: Get an institution with branches and current subscription
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Institution }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Super Admin]
 *     summary: Update an institution
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated institution }
 *   delete:
 *     tags: [Super Admin]
 *     summary: "Archive an institution (legacy endpoint — hard delete is disabled; soft-archives only, requires a reason)"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: reason, schema: { type: string }, description: "Archive reason (or send in the JSON body)" }
 *     responses:
 *       200: { description: "Archived ({ archived: true }) — data preserved" }
 *       400: { description: "Reason required (hard delete disabled)" }
 */
superAdminRouter.get("/institutions/:id", async (req, res) => {
  res.json(await service.getInstitution(uuidParam(req)));
});

superAdminRouter.patch("/institutions/:id", canManageTenant, async (req, res) => {
  const input = updateInstitutionSchema.parse(req.body);
  res.json(await service.updateInstitution(uuidParam(req), input));
});

// Hard delete is disabled. This legacy endpoint now SOFT-ARCHIVES (requires a
// reason, audited) so production tenant data is never destroyed.
superAdminRouter.delete("/institutions/:id", canManageTenant, async (req, res) => {
  const raw = (req.body as { reason?: unknown } | undefined)?.reason ?? req.query?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) {
    throw ApiError.badRequest(
      "Hard delete is disabled. Provide a 'reason' to archive this tenant instead, or use the tenant lifecycle (POST /platform/tenants/:id/lifecycle with { status: 'archived', reason })."
    );
  }
  await service.archiveInstitution(uuidParam(req), reason, actor(req));
  res.json({ archived: true });
});

/**
 * @openapi
 * /institutions/{id}/branches:
 *   get:
 *     tags: [Super Admin]
 *     summary: List an institution's branches
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Branches }
 *   post:
 *     tags: [Super Admin]
 *     summary: Create a branch under an institution
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               address: { type: string }
 *               timezone: { type: string, example: Asia/Kolkata }
 *     responses:
 *       201: { description: Created branch }
 */
superAdminRouter.get("/institutions/:id/branches", async (req, res) => {
  res.json(await service.listBranches(uuidParam(req)));
});

superAdminRouter.post("/institutions/:id/branches", canManageTenant, async (req, res) => {
  const input = createBranchSchema.parse(req.body);
  res.status(201).json(await service.createBranch(uuidParam(req), input));
});

/**
 * @openapi
 * /branches/{id}:
 *   patch:
 *     tags: [Super Admin]
 *     summary: Update a branch
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated branch }
 *   delete:
 *     tags: [Super Admin]
 *     summary: "Deactivate/archive a branch (hard delete disabled; requires a reason, soft only)"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: reason, schema: { type: string }, description: "Reason (or send in the JSON body)" }
 *     responses:
 *       200: { description: "Deactivated ({ archived: true }) — data preserved" }
 *       400: { description: "Reason required (hard delete disabled)" }
 */
superAdminRouter.patch("/branches/:id", canManageTenant, async (req, res) => {
  const input = updateBranchSchema.parse(req.body);
  res.json(await service.updateBranch(uuidParam(req), input));
});

// Hard delete is disabled — deactivate (soft) with a reason, audited.
superAdminRouter.delete("/branches/:id", canManageTenant, async (req, res) => {
  const raw = (req.body as { reason?: unknown } | undefined)?.reason ?? req.query?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) {
    throw ApiError.badRequest("Hard delete is disabled. Provide a 'reason' to deactivate/archive this branch instead.");
  }
  res.json(await service.archiveBranch(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /packages-report:
 *   get:
 *     tags: [Super Admin]
 *     summary: Package usage report (tenants by status, usage, revenue/outstanding/overdue)
 *     description: Returns JSON, or a CSV/XLSX download when format is set.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Usage report } }
 */
superAdminRouter.get("/packages-report", async (req, res) => {
  const q = packageUsageQuerySchema.parse(req.query);
  if (q.format) {
    const { columns, rows } = await service.exportPackageUsage(q);
    return sendSpreadsheet(res, q.format, "package-usage", columns, rows);
  }
  res.json(await service.packageUsageReport(q));
});

/**
 * @openapi
 * /packages-export:
 *   get:
 *     tags: [Super Admin]
 *     summary: Export the package list as CSV/XLSX
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Spreadsheet } }
 */
superAdminRouter.get("/packages-export", async (req, res) => {
  const q = packageExportQuerySchema.parse(req.query);
  const rows = (await service.listPackages(q)) as Record<string, unknown>[];
  sendSpreadsheet(res, q.format, "packages", PACKAGE_LIST_COLUMNS, rows);
});

/**
 * @openapi
 * /packages-compare:
 *   get:
 *     tags: [Super Admin]
 *     summary: Compare packages side-by-side (ids=comma,separated)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Packages to compare } }
 */
superAdminRouter.get("/packages-compare", async (req, res) => {
  const { ids } = packageCompareQuerySchema.parse(req.query);
  res.json(await service.comparePackages(ids));
});

/**
 * @openapi
 * /packages:
 *   get:
 *     tags: [Super Admin]
 *     summary: List subscription packages (search/filter/sort)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Packages } }
 *   post:
 *     tags: [Super Admin]
 *     summary: Create a subscription package (audited, versioned)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created package } }
 */
superAdminRouter.get("/packages", async (req, res) => {
  res.json(await service.listPackages(packageListQuerySchema.parse(req.query)));
});

superAdminRouter.post("/packages", canManageBilling, async (req, res) => {
  const input = createPackageSchema.parse(req.body);
  res.status(201).json(await service.createPackage(input, actor(req)));
});

/**
 * @openapi
 * /packages/{id}:
 *   get:
 *     tags: [Super Admin]
 *     summary: Get a subscription package
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Package }, 404: { description: Not found } }
 *   patch:
 *     tags: [Super Admin]
 *     summary: Update a subscription package (audited, versioned, diffed)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated package } }
 */
superAdminRouter.get("/packages/:id", async (req, res) => {
  res.json(await service.getPackage(uuidParam(req)));
});

superAdminRouter.patch("/packages/:id", canManageBilling, async (req, res) => {
  const input = updatePackageSchema.parse(req.body);
  res.json(await service.updatePackage(uuidParam(req), input, actor(req)));
});

/**
 * @openapi
 * /packages/{id}/duplicate:
 *   post:
 *     tags: [Super Admin]
 *     summary: Duplicate a package (copy starts as draft)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 201: { description: Duplicated package } }
 */
superAdminRouter.post("/packages/:id/duplicate", canManageBilling, async (req, res) => {
  const input = duplicatePackageSchema.parse(req.body);
  res.status(201).json(await service.duplicatePackage(uuidParam(req), input, actor(req)));
});

/**
 * @openapi
 * /packages/{id}/status:
 *   post:
 *     tags: [Super Admin]
 *     summary: Change package status (deprecate/archive require a reason; never hard-deleted)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated package } }
 */
superAdminRouter.post("/packages/:id/status", canManageBilling, async (req, res) => {
  const input = packageStatusSchema.parse(req.body);
  res.json(await service.setPackageStatus(uuidParam(req), input, actor(req)));
});

/**
 * @openapi
 * /packages/{id}/history:
 *   get:
 *     tags: [Super Admin]
 *     summary: Package change/version history (before/after diff)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Version history } }
 */
superAdminRouter.get("/packages/:id/history", async (req, res) => {
  res.json(await service.packageHistory(uuidParam(req)));
});

/**
 * @openapi
 * /packages/{id}/impact:
 *   get:
 *     tags: [Super Admin]
 *     summary: Assignment impact (affected tenants, active subscriptions, open invoices)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Impact summary } }
 */
superAdminRouter.get("/packages/:id/impact", async (req, res) => {
  res.json(await service.packageImpact(uuidParam(req)));
});

/**
 * @openapi
 * /institutions/{id}/subscription:
 *   post:
 *     tags: [Super Admin]
 *     summary: Assign or change an institution's subscription
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId]
 *             properties:
 *               packageId: { type: string, format: uuid }
 *               status: { type: string, enum: [active, trialing, suspended, cancelled] }
 *               startsAt: { type: string, format: date }
 *               endsAt: { type: string, format: date }
 *     responses:
 *       201: { description: Subscription assigned }
 */
superAdminRouter.post("/institutions/:id/subscription", canManageBilling, async (req, res) => {
  const input = assignSubscriptionSchema.parse(req.body);
  res.status(201).json(await service.assignSubscription(uuidParam(req), input, actor(req)));
});
