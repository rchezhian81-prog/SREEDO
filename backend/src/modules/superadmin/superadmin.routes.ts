import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { ApiError } from "../../utils/api-error";
import { authenticate, authorize } from "../../middleware/auth";
import {
  assignSubscriptionSchema,
  createBranchSchema,
  createInstitutionSchema,
  createPackageSchema,
  updateBranchSchema,
  updateInstitutionSchema,
  updatePackageSchema,
} from "./superadmin.schema";
import * as service from "./superadmin.service";

// Everything here is super-admin-only: managing tenants sits above any one
// institution's admin.
export const superAdminRouter = Router();
superAdminRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

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

superAdminRouter.post("/institutions", async (req, res) => {
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

superAdminRouter.patch("/institutions/:id", async (req, res) => {
  const input = updateInstitutionSchema.parse(req.body);
  res.json(await service.updateInstitution(uuidParam(req), input));
});

// Hard delete is disabled. This legacy endpoint now SOFT-ARCHIVES (requires a
// reason, audited) so production tenant data is never destroyed.
superAdminRouter.delete("/institutions/:id", async (req, res) => {
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

superAdminRouter.post("/institutions/:id/branches", async (req, res) => {
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
 *     summary: Delete a branch
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
superAdminRouter.patch("/branches/:id", async (req, res) => {
  const input = updateBranchSchema.parse(req.body);
  res.json(await service.updateBranch(uuidParam(req), input));
});

superAdminRouter.delete("/branches/:id", async (req, res) => {
  await service.removeBranch(uuidParam(req));
  res.status(204).end();
});

/**
 * @openapi
 * /packages:
 *   get:
 *     tags: [Super Admin]
 *     summary: List subscription packages
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Packages }
 *   post:
 *     tags: [Super Admin]
 *     summary: Create a subscription package
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               maxStudents: { type: integer }
 *               maxStaff: { type: integer }
 *               price: { type: number }
 *               billingCycle: { type: string, enum: [monthly, quarterly, annual] }
 *               features: { type: object }
 *     responses:
 *       201: { description: Created package }
 */
superAdminRouter.get("/packages", async (_req, res) => {
  res.json(await service.listPackages());
});

superAdminRouter.post("/packages", async (req, res) => {
  const input = createPackageSchema.parse(req.body);
  res.status(201).json(await service.createPackage(input));
});

/**
 * @openapi
 * /packages/{id}:
 *   patch:
 *     tags: [Super Admin]
 *     summary: Update a subscription package
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated package }
 */
superAdminRouter.patch("/packages/:id", async (req, res) => {
  const input = updatePackageSchema.parse(req.body);
  res.json(await service.updatePackage(uuidParam(req), input));
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
superAdminRouter.post("/institutions/:id/subscription", async (req, res) => {
  const input = assignSubscriptionSchema.parse(req.body);
  res.status(201).json(await service.assignSubscription(uuidParam(req), input));
});
