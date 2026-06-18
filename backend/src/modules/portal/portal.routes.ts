import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import * as portalService from "./portal.service";

export const portalRouter = Router();

// Portal is for students & parents only; staff use the main dashboard.
// Every handler is owner-scoped: a student sees only self, a parent only their
// linked children (accessibleStudentIds + assertStudentAccess).
portalRouter.use(authenticate, requireTenant, authorize("student", "parent"));

/**
 * @openapi
 * /portal/children:
 *   get:
 *     tags: [Portal]
 *     summary: The students the caller may view (self for a student, children for a parent)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Student cards with class/section and relationship }
 */
portalRouter.get("/children", async (req, res) => {
  const ids = (await accessibleStudentIds(req)) ?? [];
  res.json(await portalService.listChildren(ids, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/summary:
 *   get:
 *     tags: [Portal]
 *     summary: Profile + attendance + fee summary for an accessible student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ profile, attendance, fees }" }
 *       403: { description: Not an accessible student }
 *       404: { description: Student not found in this institution }
 */
portalRouter.get("/students/:studentId/summary", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await portalService.studentSummary(studentId, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/timetable:
 *   get:
 *     tags: [Portal]
 *     summary: The accessible student's class timetable
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Timetable entries for the student's section }
 *       403: { description: Not an accessible student }
 */
portalRouter.get("/students/:studentId/timetable", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await portalService.studentTimetable(studentId, tenantId(req)));
});
