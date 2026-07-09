import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireStaff } from "../../utils/scope";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createTeacherSchema,
  importTeachersSchema,
  listTeachersQuerySchema,
  updateTeacherSchema,
} from "./teachers.schema";
import * as teachersService from "./teachers.service";

export const teachersRouter = Router();

teachersRouter.use(authenticate, requireTenant);

// Audit important staff changes (create/update/delete), teaching + non-teaching
// alike (PR-T6). Fire after the mutation so a failed op isn't recorded.
const actorOf = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /teachers:
 *   get:
 *     tags: [Teachers]
 *     summary: List teachers
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated list of teachers }
 *   post:
 *     tags: [Teachers]
 *     summary: Add a teacher (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName]
 *             properties:
 *               employeeNo: { type: string, description: Auto-generated when omitted }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               qualification: { type: string }
 *               specialization: { type: string }
 *               joiningDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created teacher }
 */
teachersRouter.get("/", async (req, res) => {
  requireStaff(req); // staff directory carries PII — not student/parent-visible
  const queryParams = listTeachersQuerySchema.parse(req.query);
  const result = await teachersService.listTeachers(
    parsePagination(queryParams),
    { search: queryParams.search, staffType: queryParams.staffType },
    tenantId(req)
  );
  res.json(result);
});

teachersRouter.post("/", requirePermission("teachers:manage"), async (req, res) => {
  const input = createTeacherSchema.parse(req.body);
  const created = await teachersService.createTeacher(input, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "staff.create",
    targetType: "teacher",
    targetId: created.id,
    institutionId: tenantId(req),
    detail: { staffType: created.staffType, employeeNo: created.employeeNo, designation: created.designation ?? undefined },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /teachers/import:
 *   post:
 *     tags: [Teachers]
 *     summary: Bulk-import teachers from parsed CSV rows (admin)
 *     description: Validates all rows and inserts them atomically (the whole batch rolls back on any error). Omitted employee numbers are auto-generated. Limited to 1000 rows per request.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rows]
 *             properties:
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [firstName, lastName]
 *     responses:
 *       201: { description: "{ imported: number }" }
 *       400: { description: Validation failed or duplicate employee number }
 *       403: { description: Plan limit exceeded }
 */
teachersRouter.post("/import", requirePermission("teachers:manage"), async (req, res) => {
  const { rows } = importTeachersSchema.parse(req.body);
  const result = await teachersService.importTeachers(rows, tenantId(req));
  res.status(201).json(result);
});

/**
 * @openapi
 * /teachers/{id}:
 *   get:
 *     tags: [Teachers]
 *     summary: Get a teacher by id
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Teacher }
 *   patch:
 *     tags: [Teachers]
 *     summary: Update a teacher (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated teacher }
 *   delete:
 *     tags: [Teachers]
 *     summary: Remove a teacher (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
teachersRouter.get("/:id", async (req, res) => {
  requireStaff(req); // staff PII — not student/parent-visible
  res.json(await teachersService.getTeacher(uuidParam(req), tenantId(req)));
});

teachersRouter.patch("/:id", requirePermission("teachers:manage"), async (req, res) => {
  const input = updateTeacherSchema.parse(req.body);
  const id = uuidParam(req);
  const updated = await teachersService.updateTeacher(id, input, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "staff.update",
    targetType: "teacher",
    targetId: id,
    institutionId: tenantId(req),
    detail: { staffType: updated.staffType, fields: Object.keys(input) },
  });
  res.json(updated);
});

teachersRouter.delete("/:id", requirePermission("teachers:manage"), async (req, res) => {
  const id = uuidParam(req);
  await teachersService.removeTeacher(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "staff.delete",
    targetType: "teacher",
    targetId: id,
    institutionId: tenantId(req),
    detail: {},
  });
  res.status(204).end();
});
