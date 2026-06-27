import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  createStudentSchema,
  deleteStudentQuerySchema,
  importStudentsSchema,
  linkGuardianSchema,
  listStudentsQuerySchema,
  promoteStudentsSchema,
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
 * /students/import:
 *   post:
 *     tags: [Students]
 *     summary: Bulk-import students from parsed CSV rows (admin)
 *     description: Validates all rows and inserts them atomically (the whole batch rolls back on any error). Omitted admission numbers are auto-generated. Limited to 1000 rows per request.
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
 *       400: { description: Validation failed or duplicate admission number }
 *       403: { description: Plan limit exceeded }
 */
studentsRouter.post("/import", authorize("admin"), async (req, res) => {
  const { rows } = importStudentsSchema.parse(req.body);
  const result = await studentsService.importStudents(rows, tenantId(req));
  res.status(201).json(result);
});

/**
 * @openapi
 * /students/promote:
 *   post:
 *     tags: [Students]
 *     summary: Bulk-promote students to a section/semester, or graduate them (admin)
 *     description: School students move to toSectionId; college students' enrollments advance to toSemesterId. With graduate=true the selected students are marked graduated instead.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentIds]
 *             properties:
 *               studentIds: { type: array, items: { type: string, format: uuid } }
 *               toSectionId: { type: string, format: uuid }
 *               toSemesterId: { type: string, format: uuid }
 *               graduate: { type: boolean }
 *     responses:
 *       200: { description: "{ promoted, graduated }" }
 *       400: { description: No target provided, or target not found }
 */
studentsRouter.post("/promote", authorize("admin"), async (req, res) => {
  const input = promoteStudentsSchema.parse(req.body);
  res.json(await studentsService.promoteStudents(input, tenantId(req)));
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

/**
 * @openapi
 * /students/{id}/guardians:
 *   get:
 *     tags: [Students]
 *     summary: List the parent accounts linked to a student (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Linked guardians }
 *       404: { description: Student not found }
 *   post:
 *     tags: [Students]
 *     summary: Link a parent account to a student so they can view it in the portal (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string, format: uuid, description: A user account with the parent role }
 *               relationship: { type: string, description: "e.g. father, mother, guardian" }
 *     responses:
 *       201: { description: Created guardian link }
 *       400: { description: The user is not a parent account }
 *       404: { description: Student or user not found }
 *       409: { description: This parent is already linked }
 */
studentsRouter.get("/:id/guardians", authorize("admin"), async (req, res) => {
  res.json(await studentsService.listGuardians(uuidParam(req), tenantId(req)));
});

studentsRouter.post("/:id/guardians", authorize("admin"), async (req, res) => {
  const input = linkGuardianSchema.parse(req.body);
  const guardian = await studentsService.linkGuardian(uuidParam(req), input, tenantId(req));
  res.status(201).json(guardian);
});

/**
 * @openapi
 * /students/{id}/guardians/{guardianId}:
 *   delete:
 *     tags: [Students]
 *     summary: Unlink a parent account from a student (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: guardianId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Unlinked }
 *       404: { description: Guardian link not found }
 */
studentsRouter.delete("/:id/guardians/:guardianId", authorize("admin"), async (req, res) => {
  await studentsService.unlinkGuardian(
    uuidParam(req),
    uuidParam(req, "guardianId"),
    tenantId(req)
  );
  res.status(204).end();
});
