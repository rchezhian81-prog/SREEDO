import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { generateSchema } from "./timetablegen.schema";
import * as service from "./timetablegen.service";

// Timetable auto-generation — admin only, tenant-scoped. Regenerating REPLACES
// the existing timetable entries for the targeted sections.
export const timetableGenRouter = Router();
timetableGenRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /timetable-gen/generate:
 *   post:
 *     tags: [Timetable]
 *     summary: Auto-generate a clash-free timetable from class subjects (replaces existing)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days:
 *                 type: array
 *                 items: { type: integer, minimum: 0, maximum: 6 }
 *                 description: Working days (0=Sun … 6=Sat); defaults to Mon–Fri
 *               sectionIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Optional subset; defaults to all sections with subjects
 *     responses:
 *       200: { description: "Summary { sectionsScheduled, totalEntries, sections[] }" }
 *       400: { description: No periods / no class subjects }
 */
timetableGenRouter.post("/generate", async (req, res) => {
  const input = generateSchema.parse(req.body ?? {});
  res.json(await service.generateTimetable(input, tenantId(req)));
});
