import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { switchModeSchema } from "./settings.schema";
import * as service from "./settings.service";

/**
 * Super Admin Q's tenant counterpart: a unified Tenant Settings home. Mounted at
 * a distinct path, so a router-level `.use` is safe. Admin-only (matches the
 * admin-only Settings nav). Institution profile is read-only (platform-managed);
 * the only mutation is the canonical school↔college mode switch.
 */
export const settingsRouter = Router();
settingsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /tenant-settings:
 *   get:
 *     tags: [Tenant Settings]
 *     summary: "Unified tenant settings — institution profile (read-only, platform-managed), school/college mode (single source of truth), academic years + current year, branding, and enabled modules."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Tenant settings" }
 *       403: { description: "Not a tenant admin / no institution context" }
 */
settingsRouter.get("/", authorize("admin"), async (req, res) => {
  res.json(await service.getTenantSettings(tenantId(req)));
});

/**
 * @openapi
 * /tenant-settings/mode:
 *   patch:
 *     tags: [Tenant Settings]
 *     summary: "Switch the institution between school and college mode (admin). The canonical mode switch — institutions.type is the single source of truth; the type cache is busted so it takes effect immediately."
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties: { type: { type: string, enum: [school, college] } }
 *     responses:
 *       200: { description: "Updated tenant settings" }
 *       403: { description: "Not a tenant admin" }
 */
settingsRouter.patch("/mode", authorize("admin"), async (req, res) => {
  const { type } = switchModeSchema.parse(req.body);
  res.json(await service.switchMode(tenantId(req), type));
});
