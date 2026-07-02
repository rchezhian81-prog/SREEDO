import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireFeature } from "../../middleware/feature-flag";
import { uuidParam } from "../../utils/params";
import {
  createLiveClassSchema,
  updateLiveClassSchema,
} from "./liveclasses.schema";
import * as service from "./liveclasses.service";

export const liveClassesRouter = Router();

// Optional add-on module: a super-admin can switch it off per tenant via
// settings.featureFlags.liveClasses (default-allow; super_admin bypasses).
const guard = [authenticate, requireTenant, requireFeature("liveClasses", "Live Classes")];
// Scheduling is for staff; everyone in the tenant can see the schedule.
const canWrite = authorize("admin", "teacher");

/**
 * @openapi
 * /live-classes:
 *   get:
 *     tags: [LiveClasses]
 *     summary: List the tenant's live classes (newest first)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Live classes ordered by scheduled time }
 *   post:
 *     tags: [LiveClasses]
 *     summary: Schedule a live class (admin / teacher)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, joinUrl, scheduledAt]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               subject: { type: string }
 *               target: { type: string, description: "Class/section or program/semester" }
 *               provider: { type: string, enum: [zoom, meet, teams, jitsi, other] }
 *               joinUrl: { type: string, format: uri }
 *               hostName: { type: string }
 *               scheduledAt: { type: string, format: date-time }
 *               durationMin: { type: integer }
 *     responses:
 *       201: { description: Created live class }
 */
liveClassesRouter.get("/", ...guard, async (req, res) => {
  res.json(await service.list(tenantId(req)));
});

liveClassesRouter.post("/", ...guard, canWrite, async (req, res) => {
  const input = createLiveClassSchema.parse(req.body);
  res
    .status(201)
    .json(await service.create(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /live-classes/{id}:
 *   patch:
 *     tags: [LiveClasses]
 *     summary: Update or change the status of a live class (admin / teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated live class }
 *       404: { description: Not found }
 *   delete:
 *     tags: [LiveClasses]
 *     summary: Delete a live class (admin / teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
liveClassesRouter.patch("/:id", ...guard, canWrite, async (req, res) => {
  const input = updateLiveClassSchema.parse(req.body);
  res.json(await service.update(uuidParam(req), input, tenantId(req)));
});

liveClassesRouter.delete("/:id", ...guard, canWrite, async (req, res) => {
  await service.remove(uuidParam(req), tenantId(req));
  res.status(204).end();
});
