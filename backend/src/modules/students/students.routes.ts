import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  createStudentSchema,
  deleteStudentQuerySchema,
  listStudentsQuerySchema,
  updateStudentSchema,
} from "./students.schema";
import * as studentsService from "./students.service";

export const studentsRouter = Router();

studentsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /students:
 *   get:
 *     tags: [Students]
 *     summary: List students with search and filters
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, graduated, transferred, archived] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated list of students }
 *   post:
 *     tags: [Students]
 *     summary: Enroll a new student (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName]
 *             properties:
 *               admissionNo: { type: string, description: Auto-generated when omitted }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               gender: { type: string, enum: [male, female, other] }
 *               sectionId: { type: string, format: uuid }
 *               guardianName: { type: string }
 *               guardianPhone: { type: string }
 *               guardianEmail: { type: string, format: email }
 *               address: { type: string }
 *     responses:
 *       201: { description: Created student }
 */
studentsRouter.get("/", async (req, res) => {
  const queryParams = listStudentsQuerySchema.parse(req.query);
  const result = await studentsService.listStudents(
    parsePagination(queryParams),
    queryParams,
    tenantId(req),
    await accessibleStudentIds(req)
  );
  res.json(result);
});

studentsRouter.post("/", authorize("admin"), async (req, res) => {
  const input = createStudentSchema.parse(req.body);
  const student = await studentsService.createStudent(input, tenantId(req));
  res.status(201).json(student);
});

/**
 * @openapi
 * /students/{id}:
 *   get:
 *     tags: [Students]
 *     summary: Get a student by id
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Student }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Students]
 *     summary: Update a student (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated student }
 *   delete:
 *     tags: [Students]
 *     summary: Archive a student (admin); soft delete by default
 *     description: Marks the student archived, preserving attendance/fees history. Pass hard=true to permanently delete the row and its dependent records.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: hard, schema: { type: boolean }, description: Permanently delete instead of archiving }
 *     responses:
 *       204: { description: Archived (or deleted when hard=true) }
 */
studentsRouter.get("/:id", async (req, res) => {
  const id = uuidParam(req);
  assertStudentAccess(await accessibleStudentIds(req), id);
  res.json(await studentsService.getStudent(id, tenantId(req)));
});

studentsRouter.patch("/:id", authorize("admin"), async (req, res) => {
  const input = updateStudentSchema.parse(req.body);
  res.json(await studentsService.updateStudent(uuidParam(req), input, tenantId(req)));
});

studentsRouter.delete("/:id", authorize("admin"), async (req, res) => {
  const { hard } = deleteStudentQuerySchema.parse(req.query);
  const id = uuidParam(req);
  if (hard) {
    await studentsService.hardDeleteStudent(id, tenantId(req));
  } else {
    await studentsService.archiveStudent(id, tenantId(req));
  }
  res.status(204).end();
});
