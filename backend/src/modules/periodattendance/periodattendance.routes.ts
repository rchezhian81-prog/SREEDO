import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { rosterQuerySchema, markSchema } from "./periodattendance.schema";
import * as service from "./periodattendance.service";

// Period-wise attendance — admins & teachers, tenant-scoped.
export const periodAttendanceRouter = Router();
periodAttendanceRouter.use(authenticate, requireTenant, authorize("admin", "teacher"));

/**
 * @openapi
 * /period-attendance/roster:
 *   get:
 *     tags: [Period Attendance]
 *     summary: A section's roster with each student's mark for a date + period
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sectionId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: date, required: true, schema: { type: string, format: date } }
 *       - { in: query, name: periodId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ records: [{ studentId, name, admissionNo, status }] }" }
 */
periodAttendanceRouter.get("/roster", async (req, res) => {
  const filters = rosterQuerySchema.parse(req.query);
  res.json(await service.getRoster(filters, tenantId(req)));
});

/**
 * @openapi
 * /period-attendance:
 *   post:
 *     tags: [Period Attendance]
 *     summary: Mark (bulk upsert) period attendance for a date + period
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, periodId, entries]
 *             properties:
 *               date: { type: string, format: date }
 *               periodId: { type: string, format: uuid }
 *               subjectId: { type: string, format: uuid }
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [studentId, status]
 *                   properties:
 *                     studentId: { type: string, format: uuid }
 *                     status: { type: string, enum: [present, absent, late, excused] }
 *     responses:
 *       200: { description: "{ marked: number }" }
 */
periodAttendanceRouter.post("/", async (req, res) => {
  const input = markSchema.parse(req.body);
  res.json(await service.markAttendance(input, tenantId(req), req.user!.id));
});
