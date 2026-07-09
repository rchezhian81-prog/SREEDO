import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import { createLeaveSchema, reviewLeaveSchema, listLeaveQuerySchema } from "./studentleave.schema";
import * as service from "./studentleave.service";

// PR-T9 — Student Leave. Staff surface gated by student_leave:*; the /my parent
// surface is guardian-scoped (a parent may only file/cancel/view for their own
// linked children) and needs no student_leave grant. Tenant-scoped throughout.
export const studentLeaveRouter = Router();
studentLeaveRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip ?? null,
});

// ---- Parent (guardian-scoped) — declared before /:id to avoid clashes ----

/**
 * @openapi
 * /student-leave/my:
 *   get:
 *     tags: [Student Leave]
 *     summary: Leave requests for the caller's linked children (parent)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Requests } }
 *   post:
 *     tags: [Student Leave]
 *     summary: File a leave request for one of the caller's children (guardian-scoped)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [studentId, fromDate, toDate], properties: { studentId: { type: string, format: uuid }, type: { type: string, enum: [sick, casual, emergency, other] }, fromDate: { type: string, format: date }, toDate: { type: string, format: date }, reason: { type: string } } } } }
 *     responses: { 201: { description: Created request }, 403: { description: Not your child } }
 */
studentLeaveRouter.get("/my", async (req, res) => {
  res.json(await service.listForParent(req.user!.id, tenantId(req)));
});

studentLeaveRouter.post("/my", async (req, res) => {
  const input = createLeaveSchema.parse(req.body);
  const created = await service.parentCreate(input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "student_leave.request.create", targetType: "student_leave", targetId: created.id as string,
    institutionId: tenantId(req), detail: { via: "guardian" },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /student-leave/my/{id}:
 *   delete:
 *     tags: [Student Leave]
 *     summary: Cancel the caller's own leave request (parent)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Cancelled }, 403: { description: Not your request } }
 */
studentLeaveRouter.delete("/my/:id", async (req, res) => {
  const id = uuidParam(req);
  await service.cancelRequest(id, tenantId(req), { userId: req.user!.id, isStaff: false });
  await recordAudit(actorOf(req), {
    action: "student_leave.cancel", targetType: "student_leave", targetId: id,
    institutionId: tenantId(req), detail: { via: "guardian" },
  });
  res.status(204).end();
});

// ---- Staff (student_leave:*) ----

/**
 * @openapi
 * /student-leave:
 *   get:
 *     tags: [Student Leave]
 *     summary: List student leave requests (filter by status / student)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected, cancelled] } }
 *       - { in: query, name: studentId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Paginated requests } }
 *   post:
 *     tags: [Student Leave]
 *     summary: File a student leave request on behalf (staff)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [studentId, fromDate, toDate], properties: { studentId: { type: string, format: uuid }, type: { type: string, enum: [sick, casual, emergency, other] }, fromDate: { type: string, format: date }, toDate: { type: string, format: date }, reason: { type: string } } } } }
 *     responses: { 201: { description: Created request } }
 */
studentLeaveRouter.get("/", requirePermission("student_leave:read"), async (req, res) => {
  const params = listLeaveQuerySchema.parse(req.query);
  res.json(await service.listRequests(parsePagination(params), params, tenantId(req)));
});

studentLeaveRouter.post("/", requirePermission("student_leave:create"), async (req, res) => {
  const input = createLeaveSchema.parse(req.body);
  const created = await service.staffCreate(input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "student_leave.request.create", targetType: "student_leave", targetId: created.id as string,
    institutionId: tenantId(req), detail: { via: "staff" },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /student-leave/{id}:
 *   get: { tags: [Student Leave], summary: Get one request, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Request } } }
 *   delete: { tags: [Student Leave], summary: Cancel a request (staff; reverts excused marks if it was approved), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Cancelled } } }
 */
studentLeaveRouter.get("/:id", requirePermission("student_leave:read"), async (req, res) => {
  res.json(await service.getRequest(uuidParam(req), tenantId(req)));
});

studentLeaveRouter.delete("/:id", requirePermission("student_leave:approve"), async (req, res) => {
  const id = uuidParam(req);
  await service.cancelRequest(id, tenantId(req), { userId: req.user!.id, isStaff: true });
  await recordAudit(actorOf(req), {
    action: "student_leave.cancel", targetType: "student_leave", targetId: id,
    institutionId: tenantId(req), detail: { via: "staff" },
  });
  res.status(204).end();
});

/**
 * @openapi
 * /student-leave/{id}/approve:
 *   post:
 *     tags: [Student Leave]
 *     summary: Approve a request (marks the student excused in daily attendance)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { reviewNote: { type: string } } } } } }
 *     responses: { 200: { description: Approved request } }
 */
studentLeaveRouter.post("/:id/approve", requirePermission("student_leave:approve"), async (req, res) => {
  const input = reviewLeaveSchema.parse(req.body ?? {});
  const id = uuidParam(req);
  const updated = await service.approveRequest(id, input, tenantId(req), { id: req.user!.id });
  await recordAudit(actorOf(req), {
    action: "student_leave.approve", targetType: "student_leave", targetId: id,
    institutionId: tenantId(req), detail: { studentId: updated.studentId },
  });
  res.json(updated);
});

/**
 * @openapi
 * /student-leave/{id}/reject:
 *   post:
 *     tags: [Student Leave]
 *     summary: Reject a request (no attendance change)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody: { content: { application/json: { schema: { type: object, properties: { reviewNote: { type: string } } } } } }
 *     responses: { 200: { description: Rejected request } }
 */
studentLeaveRouter.post("/:id/reject", requirePermission("student_leave:approve"), async (req, res) => {
  const input = reviewLeaveSchema.parse(req.body ?? {});
  const id = uuidParam(req);
  const updated = await service.rejectRequest(id, input, tenantId(req), { id: req.user!.id });
  await recordAudit(actorOf(req), {
    action: "student_leave.reject", targetType: "student_leave", targetId: id,
    institutionId: tenantId(req), detail: {},
  });
  res.json(updated);
});
