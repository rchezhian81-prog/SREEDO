import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import {
  accessibleStudentIds,
  assertStudentAccess,
  requireStaff,
} from "../../utils/scope";
import {
  attendanceQuerySchema,
  bulkMarkAttendanceSchema,
  studentAttendanceQuerySchema,
} from "./attendance.schema";
import * as attendanceService from "./attendance.service";

export const attendanceRouter = Router();

attendanceRouter.use(authenticate);

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
  res.json(await attendanceService.listByDate(filters));
});

attendanceRouter.post("/", authorize("admin", "teacher"), async (req, res) => {
  const input = bulkMarkAttendanceSchema.parse(req.body);
  res.json(await attendanceService.bulkMark(input, req.user!.id));
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
  res.json(await attendanceService.studentHistory(studentId, range));
});
