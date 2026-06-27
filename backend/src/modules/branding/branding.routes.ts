import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { updateBrandingSchema } from "./branding.schema";
import * as service from "./branding.service";

// Branding — readable by any tenant user (to render the UI); editable by admins.
export const brandingRouter = Router();
brandingRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /branding:
 *   get:
 *     tags: [Branding]
 *     summary: Get the caller institution's branding
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ displayName, logoUrl, primaryColor, tagline }" }
 *   patch:
 *     tags: [Branding]
 *     summary: Update branding (admin only)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName: { type: string }
 *               logoUrl: { type: string, format: uri }
 *               primaryColor: { type: string, example: "#1d4ed8" }
 *               tagline: { type: string }
 *     responses:
 *       200: { description: Updated branding }
 *       403: { description: Admins only }
 */
brandingRouter.get("/", async (req, res) => {
  res.json(await service.getBranding(tenantId(req)));
});

brandingRouter.patch("/", authorize("admin"), async (req, res) => {
  const input = updateBrandingSchema.parse(req.body);
  res.json(await service.upsertBranding(input, tenantId(req)));
});
