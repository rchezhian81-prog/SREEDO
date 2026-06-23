import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createTeacherSchema,
  importTeachersSchema,
  listTeachersQuerySchema,
  updateTeacherSchema,
} from "./teachers.schema";
import * as teachersService from "./teachers.service";

export const teachersRouter = Router();

teachersRouter.use(authenticate, requireTenant);

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
  const queryParams = listTeachersQuerySchema.parse(req.query);
  const result = await teachersService.listTeachers(
    parsePagination(queryParams),
    { search: queryParams.search },
    tenantId(req)
  );
  res.json(result);
});

teachersRouter.post("/", authorize("admin"), async (req, res) => {
  const input = createTeacherSchema.parse(req.body);
  res.status(201).json(await teachersService.createTeacher(input, tenantId(req)));
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
teachersRouter.post("/import", authorize("admin"), async (req, res) => {
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
  res.json(await teachersService.getTeacher(uuidParam(req), tenantId(req)));
});

teachersRouter.patch("/:id", authorize("admin"), async (req, res) => {
  const input = updateTeacherSchema.parse(req.body);
  res.json(await teachersService.updateTeacher(uuidParam(req), input, tenantId(req)));
});

teachersRouter.delete("/:id", authorize("admin"), async (req, res) => {
  await teachersService.removeTeacher(uuidParam(req), tenantId(req));
  res.status(204).end();
});
