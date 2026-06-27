import type { Request } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import {
  createBackupSchema,
  listBackupsQuerySchema,
  restoreSchema,
  updateSettingsSchema,
} from "./backups.schema";
import * as service from "./backups.service";

// Backups sit ABOVE any tenant: super-admin only. authorize("super_admin") is the
// hard boundary; requirePermission documents/enforces the granular backup:* model.
export const backupsRouter = Router();
backupsRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /backups:
 *   get:
 *     tags: [Backups]
 *     summary: List database backups (metadata only; never exposes storage paths)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: scope, schema: { type: string, enum: [global, institution] } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, running, success, failed] } }
 *       - { in: query, name: institutionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: Backups }
 *   post:
 *     tags: [Backups]
 *     summary: Trigger a manual backup now (super admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created backup metadata }
 */
backupsRouter.get("/", requirePermission("backup:read"), async (req, res) => {
  res.json(await service.listBackups(listBackupsQuerySchema.parse(req.query)));
});
backupsRouter.post("/", requirePermission("backup:create"), async (req, res) => {
  res.status(201).json(await service.createBackup(createBackupSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /backups/settings:
 *   get:
 *     tags: [Backups]
 *     summary: Get retention + automatic-schedule settings
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings }
 *   patch:
 *     tags: [Backups]
 *     summary: Update retention + schedule settings (super admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated settings }
 */
backupsRouter.get("/settings", requirePermission("backup:read"), async (_req, res) => {
  res.json(await service.getSettings());
});
backupsRouter.patch("/settings", requirePermission("backup:manage"), async (req, res) => {
  res.json(await service.updateSettings(updateSettingsSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /backups/{id}:
 *   get:
 *     tags: [Backups]
 *     summary: Get one backup's metadata
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Backup }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Backups]
 *     summary: Delete a backup and its artifact (super admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Deleted }
 */
backupsRouter.get("/:id", requirePermission("backup:read"), async (req, res) => {
  res.json(await service.getBackup(uuidParam(req)));
});
backupsRouter.delete("/:id", requirePermission("backup:manage"), async (req, res) => {
  res.json(await service.deleteBackup(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /backups/{id}/download:
 *   get:
 *     tags: [Backups]
 *     summary: Download a backup artifact through a protected route (audited)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The gzipped backup bytes }
 *       400: { description: No artifact available }
 */
backupsRouter.get("/:id/download", requirePermission("backup:download"), async (req, res) => {
  const { buffer, filename } = await service.downloadBackup(uuidParam(req), actor(req));
  res
    .type("application/gzip")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(buffer);
});

/**
 * @openapi
 * /backups/{id}/restore/preview:
 *   get:
 *     tags: [Backups]
 *     summary: Preview what a restore would load (non-destructive)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Restore preview (scope, schema match, per-table row counts) }
 */
backupsRouter.get("/:id/restore/preview", requirePermission("backup:restore"), async (req, res) => {
  res.json(await service.restorePreview(uuidParam(req)));
});

/**
 * @openapi
 * /backups/{id}/restore:
 *   post:
 *     tags: [Backups]
 *     summary: Restore the database from a global backup (destructive; audited)
 *     description: Requires confirm=true always, and force=true in production. Super admin only.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirm]
 *             properties:
 *               confirm: { type: boolean }
 *               force: { type: boolean }
 *     responses:
 *       200: { description: Restored }
 *       400: { description: Confirmation/force required, or non-restorable backup }
 */
backupsRouter.post("/:id/restore", requirePermission("backup:restore"), async (req, res) => {
  res.json(await service.restoreBackup(uuidParam(req), restoreSchema.parse(req.body ?? {}), actor(req)));
});
