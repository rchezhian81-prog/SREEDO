import type { Request } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import {
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  decideLeaveSchema,
  listAttendanceQuerySchema,
  markAttendanceSchema,
  setBalanceSchema,
  summaryQuerySchema,
  updateAttendanceSchema,
  updateLeaveTypeSchema,
} from "./staffleave.schema";
import * as service from "./staffleave.service";

// Roles that see all staff data; everyone else is scoped to their own record.
const VIEW_ALL = new Set(["admin", "accountant", "super_admin"]);
const canViewAll = (req: Request) => VIEW_ALL.has(req.user!.role);
const canActForOthers = (req: Request) =>
  req.user!.role === "admin" || req.user!.role === "super_admin";

async function ownTeacherOrNull(req: Request): Promise<string | null> {
  return service.teacherIdForUser(req.user!.id, tenantId(req));
}
async function ownTeacherRequired(req: Request): Promise<string> {
  const id = await ownTeacherOrNull(req);
  if (!id) throw ApiError.forbidden("No staff record is linked to your account");
  return id;
}

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

// ===================== Staff attendance (mounted at /staff) =====================

export const staffAttendanceRouter = Router();
staffAttendanceRouter.use(authenticate, requireTenant);

const attRead = requirePermission("staff_attendance:read");
const attCreate = requirePermission("staff_attendance:create");
const attUpdate = requirePermission("staff_attendance:update");
const attDelete = requirePermission("staff_attendance:delete");

/**
 * @openapi
 * /staff/attendance:
 *   get:
 *     tags: [Staff Attendance]
 *     summary: List staff attendance (by date/month/teacher). Staff see only their own.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *       - { in: query, name: month, schema: { type: string, example: "2026-07" } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Attendance rows } }
 *   post:
 *     tags: [Staff Attendance]
 *     summary: Bulk-mark staff attendance for a date (upsert)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, entries]
 *             properties:
 *               date: { type: string, format: date }
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [teacherId, status]
 *                   properties:
 *                     teacherId: { type: string, format: uuid }
 *                     status: { type: string, enum: [present, absent, half_day, leave, holiday] }
 *                     checkIn: { type: string, example: "09:00" }
 *                     checkOut: { type: string, example: "17:00" }
 *                     late: { type: boolean }
 *                     earlyOut: { type: boolean }
 *                     remarks: { type: string }
 *     responses: { 200: { description: "{ date, marked }" } }
 */
staffAttendanceRouter.get("/attendance", attRead, async (req, res) => {
  const q = listAttendanceQuerySchema.parse(req.query);
  if (!canViewAll(req)) {
    const own = await ownTeacherOrNull(req);
    if (!own) return res.json([]);
    return res.json(await service.listAttendance(tenantId(req), { ...q, teacherId: own }));
  }
  res.json(await service.listAttendance(tenantId(req), q));
});

staffAttendanceRouter.post("/attendance", attCreate, async (req, res) => {
  const input = markAttendanceSchema.parse(req.body);
  res.json(await service.markAttendance(input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /staff/attendance/summary:
 *   get:
 *     tags: [Staff Attendance]
 *     summary: Staff-wise monthly attendance summary (counts per status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: month, required: true, schema: { type: string, example: "2026-07" } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Summary rows } }
 */
staffAttendanceRouter.get("/attendance/summary", attRead, async (req, res) => {
  const q = summaryQuerySchema.parse(req.query);
  const teacherId = canViewAll(req) ? q.teacherId : await ownTeacherRequired(req);
  res.json(await service.monthlySummary(tenantId(req), q.month, teacherId));
});

/**
 * @openapi
 * /staff/attendance/payroll-summary:
 *   get:
 *     tags: [Staff Attendance]
 *     summary: Payroll-attendance summary for a month (working/present/absent/paid+unpaid leave/late)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: month, required: true, schema: { type: string, example: "2026-07" } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Payroll summary rows } }
 */
staffAttendanceRouter.get("/attendance/payroll-summary", attRead, async (req, res) => {
  const q = summaryQuerySchema.parse(req.query);
  const teacherId = canViewAll(req) ? q.teacherId : await ownTeacherRequired(req);
  res.json(await service.payrollSummary(tenantId(req), q.month, teacherId));
});

/**
 * @openapi
 * /staff/attendance/{id}:
 *   patch:
 *     tags: [Staff Attendance]
 *     summary: Update a staff attendance record
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Staff Attendance]
 *     summary: Delete a staff attendance record
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
staffAttendanceRouter.patch("/attendance/:id", attUpdate, async (req, res) => {
  res.json(await service.updateAttendance(uuidParam(req), updateAttendanceSchema.parse(req.body), tenantId(req)));
});
staffAttendanceRouter.delete("/attendance/:id", attDelete, async (req, res) => {
  await service.deleteAttendance(uuidParam(req), tenantId(req));
  res.status(204).end();
});

// ===================== Leave (mounted at /leave) =====================

export const leaveRouter = Router();
leaveRouter.use(authenticate, requireTenant);

const leaveRead = requirePermission("leave:read");
const leaveCreate = requirePermission("leave:create");
const leaveApprove = requirePermission("leave:approve"); // also the "leave admin" gate
const leaveReject = requirePermission("leave:reject");

/**
 * @openapi
 * /leave/types:
 *   get:
 *     tags: [Leave]
 *     summary: List leave types
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Leave types } }
 *   post:
 *     tags: [Leave]
 *     summary: Create a leave type (leave admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string, example: Casual Leave }
 *               code: { type: string, example: CL }
 *               isPaid: { type: boolean }
 *               defaultBalance: { type: number }
 *     responses: { 201: { description: Created }, 409: { description: Duplicate code } }
 */
leaveRouter.get("/types", leaveRead, async (req, res) => {
  res.json(await service.listLeaveTypes(tenantId(req)));
});
leaveRouter.post("/types", leaveApprove, async (req, res) => {
  res.status(201).json(await service.createLeaveType(createLeaveTypeSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /leave/types/{id}:
 *   patch:
 *     tags: [Leave]
 *     summary: Update a leave type (leave admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Leave]
 *     summary: Delete a leave type (leave admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
leaveRouter.patch("/types/:id", leaveApprove, async (req, res) => {
  res.json(await service.updateLeaveType(uuidParam(req), updateLeaveTypeSchema.parse(req.body), tenantId(req)));
});
leaveRouter.delete("/types/:id", leaveApprove, async (req, res) => {
  await service.deleteLeaveType(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /leave/balances:
 *   get:
 *     tags: [Leave]
 *     summary: List leave balances (staff see only their own)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: teacherId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Balances } }
 *   post:
 *     tags: [Leave]
 *     summary: Set a staff member's leave balance (upsert, leave admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [teacherId, leaveTypeId, balance], properties: { teacherId: { type: string, format: uuid }, leaveTypeId: { type: string, format: uuid }, balance: { type: number } } }
 *     responses: { 200: { description: Balance saved } }
 */
leaveRouter.get("/balances", leaveRead, async (req, res) => {
  if (!canViewAll(req)) {
    const own = await ownTeacherOrNull(req);
    return res.json(own ? await service.listBalances(tenantId(req), own) : []);
  }
  res.json(await service.listBalances(tenantId(req), optStr(req.query.teacherId)));
});
leaveRouter.post("/balances", leaveApprove, async (req, res) => {
  res.json(await service.setBalance(setBalanceSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /leave/requests:
 *   get:
 *     tags: [Leave]
 *     summary: List leave requests (staff see only their own)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected, cancelled] } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Requests } }
 *   post:
 *     tags: [Leave]
 *     summary: Request leave (staff request for themselves; admins may pass teacherId)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [leaveTypeId, startDate, endDate]
 *             properties:
 *               teacherId: { type: string, format: uuid }
 *               leaveTypeId: { type: string, format: uuid }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               reason: { type: string }
 *     responses: { 201: { description: Created request } }
 */
leaveRouter.get("/requests", leaveRead, async (req, res) => {
  const filters = { status: optStr(req.query.status), teacherId: optStr(req.query.teacherId) };
  if (!canViewAll(req)) {
    const own = await ownTeacherOrNull(req);
    return res.json(own ? await service.listRequests(tenantId(req), { ...filters, teacherId: own }) : []);
  }
  res.json(await service.listRequests(tenantId(req), filters));
});
leaveRouter.post("/requests", leaveCreate, async (req, res) => {
  const input = createLeaveRequestSchema.parse(req.body);
  const teacherId =
    canActForOthers(req) && input.teacherId ? input.teacherId : await ownTeacherRequired(req);
  res.status(201).json(await service.createRequest(input, teacherId, tenantId(req)));
});

/**
 * @openapi
 * /leave/requests/{id}/approve:
 *   post:
 *     tags: [Leave]
 *     summary: Approve a leave request (deducts balance, marks attendance)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Approved }, 409: { description: Insufficient leave balance } }
 */
leaveRouter.post("/requests/:id/approve", leaveApprove, async (req, res) => {
  const { note } = decideLeaveSchema.parse(req.body ?? {});
  res.json(await service.approveRequest(uuidParam(req), req.user!.id, note, tenantId(req)));
});

/**
 * @openapi
 * /leave/requests/{id}/reject:
 *   post:
 *     tags: [Leave]
 *     summary: Reject a leave request
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Rejected } }
 */
leaveRouter.post("/requests/:id/reject", leaveReject, async (req, res) => {
  const { note } = decideLeaveSchema.parse(req.body ?? {});
  res.json(await service.rejectRequest(uuidParam(req), req.user!.id, note, tenantId(req)));
});

/**
 * @openapi
 * /leave/requests/{id}/cancel:
 *   post:
 *     tags: [Leave]
 *     summary: Cancel a leave request (own pending; admins any pending/approved)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Cancelled } }
 */
leaveRouter.post("/requests/:id/cancel", leaveRead, async (req, res) => {
  const restrict = canViewAll(req) ? undefined : await ownTeacherRequired(req);
  res.json(await service.cancelRequest(uuidParam(req), tenantId(req), restrict));
});
