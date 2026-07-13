import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { requireTenant, tenantId } from "../../middleware/tenant";
import {
  accessibleStudentIds,
  assertStudentAccess,
  requireStaff,
} from "../../utils/scope";
import {
  assertSectionInTeacherScope,
  assertStudentsInTeacherScope,
  resolveTeacherScope,
  scopedSectionIds,
} from "../../utils/teacher-scope";
import {
  attendanceQuerySchema,
  bulkMarkAttendanceSchema,
  studentAttendanceQuerySchema,
} from "./attendance.schema";
import * as attendanceService from "./attendance.service";

export const attendanceRouter = Router();

attendanceRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /attendance:
 *   get:
 *     tags: [Attendance]
 *     summary: List attendance for a date (defaults to today), optionally by section
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Active students with their attendance status for the date }
 *   post:
 *     tags: [Attendance]
 *     summary: Mark attendance in bulk for a date (admin/teacher), idempotent upsert
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, records]
 *             properties:
 *               date: { type: string, format: date }
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [studentId, status]
 *                   properties:
 *                     studentId: { type: string, format: uuid }
 *                     status: { type: string, enum: [present, absent, late, excused] }
 *                     remarks: { type: string }
 *     responses:
 *       200: { description: Upsert summary }
 */
attendanceRouter.get("/", async (req, res) => {
  requireStaff(req); // section roster is staff-only
  const filters = attendanceQuerySchema.parse(req.query);
  // A scoped teacher may only pull their own sections' rosters: an explicitly
  // requested foreign section is a 403; an unfiltered list is narrowed to owned.
  const scope = await resolveTeacherScope(req);
  await assertSectionInTeacherScope(req, scope, filters.sectionId, "attendance:list");
  res.json(
    await attendanceService.listByDate(filters, tenantId(req), scopedSectionIds(scope))
  );
});

attendanceRouter.post("/", requirePermission("attendance:mark"), async (req, res) => {
  const input = bulkMarkAttendanceSchema.parse(req.body);
  const scope = await resolveTeacherScope(req);
  await assertStudentsInTeacherScope(
    req,
    scope,
    input.records.map((r) => r.studentId),
    "attendance:mark",
    tenantId(req)
  );
  res.json(await attendanceService.bulkMark(input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /attendance/students/{studentId}:
 *   get:
 *     tags: [Attendance]
 *     summary: Attendance history and summary for one student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Records plus per-status counts }
 */
attendanceRouter.get("/students/:studentId", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  const range = studentAttendanceQuerySchema.parse(req.query);
  res.json(
    await attendanceService.studentHistory(studentId, range, tenantId(req))
  );
});
