import type { Request, Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import * as settings from "./platform-settings.service";
import {
  featureFlagCreateSchema,
  featureFlagStatusSchema,
  featureFlagUpdateSchema,
  rollbackSchema,
  settingsHistoryQuerySchema,
  updatePlatformSettingsSchema,
} from "./platform-settings.schema";

/**
 * Super Admin N — Global Platform Settings + Feature-flag governance.
 * Super-admin only; sensitive changes are audited in the service via
 * platform_audit_log. Tenant-specific settings are NOT served here (they live in
 * the Tenant module). No secret is ever returned.
 */
export const platformSettingsRouter = Router();

const superAdmin = [authenticate, authorize("super_admin")] as const;
const canRead = [...superAdmin, requirePermission("platform:settings_read")];
const canManage = [...superAdmin, requirePermission("platform:settings_manage")];

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /platform/settings:
 *   get:
 *     tags: [Platform Settings]
 *     summary: Get global platform settings
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Global platform settings } }
 *   patch:
 *     tags: [Platform Settings]
 *     summary: Update global platform settings (audited, diffed)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Updated settings } }
 */
platformSettingsRouter.get("/settings", ...canRead, async (_req: Request, res: Response) => {
  res.json(await settings.getSettings());
});
platformSettingsRouter.patch("/settings", ...canManage, async (req: Request, res: Response) => {
  const body = updatePlatformSettingsSchema.parse(req.body);
  res.json(await settings.updateSettings(body, actor(req)));
});

/**
 * @openapi
 * /platform/settings/info:
 *   get:
 *     tags: [Platform Settings]
 *     summary: Safe platform info + integration status (no secrets)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Allow-listed platform info } }
 */
platformSettingsRouter.get("/settings/info", ...canRead, (_req: Request, res: Response) => {
  res.json(settings.platformInfo());
});

/**
 * @openapi
 * /platform/settings/history:
 *   get:
 *     tags: [Platform Settings]
 *     summary: Settings + feature-flag change history (with before/after diff)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Paged audit rows } }
 */
platformSettingsRouter.get("/settings/history", ...canRead, async (req: Request, res: Response) => {
  const q = settingsHistoryQuerySchema.parse(req.query);
  res.json(await settings.listSettingsHistory(q));
});

/**
 * @openapi
 * /platform/settings/rollback:
 *   post:
 *     tags: [Platform Settings]
 *     summary: Safely roll back a global platform-settings change (audited)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Settings after rollback } }
 */
platformSettingsRouter.post("/settings/rollback", ...canManage, async (req: Request, res: Response) => {
  const { auditId, reason } = rollbackSchema.parse(req.body);
  res.json(await settings.rollbackSettings(auditId, reason, actor(req)));
});

/**
 * @openapi
 * /platform/feature-flags:
 *   get:
 *     tags: [Platform Settings]
 *     summary: List platform feature flags
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Feature flags } }
 *   post:
 *     tags: [Platform Settings]
 *     summary: Create a platform feature flag (audited)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created flag } }
 */
platformSettingsRouter.get("/feature-flags", ...canRead, async (_req: Request, res: Response) => {
  res.json(await settings.listFeatureFlags());
});
platformSettingsRouter.post("/feature-flags", ...canManage, async (req: Request, res: Response) => {
  const body = featureFlagCreateSchema.parse(req.body);
  res.status(201).json(await settings.createFeatureFlag(body, actor(req)));
});

/**
 * @openapi
 * /platform/feature-flags/{id}:
 *   patch:
 *     tags: [Platform Settings]
 *     summary: Update a feature flag (audited, diffed)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated flag } }
 */
platformSettingsRouter.patch("/feature-flags/:id", ...canManage, async (req: Request, res: Response) => {
  const id = uuidParam(req);
  const body = featureFlagUpdateSchema.parse(req.body);
  res.json(await settings.updateFeatureFlag(id, body, actor(req)));
});

/**
 * @openapi
 * /platform/feature-flags/{id}/status:
 *   post:
 *     tags: [Platform Settings]
 *     summary: Enable / disable / roll out a feature flag (audited)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated flag } }
 */
platformSettingsRouter.post("/feature-flags/:id/status", ...canManage, async (req: Request, res: Response) => {
  const id = uuidParam(req);
  const { status, rolloutPercentage, reason } = featureFlagStatusSchema.parse(req.body);
  res.json(await settings.setFeatureFlagStatus(id, status, rolloutPercentage, reason, actor(req)));
});

/**
 * @openapi
 * /platform/runtime-status:
 *   get:
 *     tags: [Platform Settings]
 *     summary: Maintenance + announcement banner status for the current user
 *     description: Any authenticated user. Announcement is gated by visibility vs the caller's role; no secrets.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Runtime banner status } }
 */
platformSettingsRouter.get("/runtime-status", authenticate, async (req: Request, res: Response) => {
  res.json(await settings.runtimeStatus(req.user?.role));
});
