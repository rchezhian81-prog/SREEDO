import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { parsePagination } from "../../utils/pagination";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  updateStudentSchema,
} from "./students.schema";
import * as studentsService from "./students.service";

export const studentsRouter = Router();

studentsRouter.use(authenticate);

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
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, graduated, transferred] } }
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
    queryParams
  );
  res.json(result);
});

studentsRouter.post("/", authorize("admin"), async (req, res) => {
  const input = createStudentSchema.parse(req.body);
  const student = await studentsService.createStudent(input);
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
 *     summary: Delete a student record (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
studentsRouter.get("/:id", async (req, res) => {
  res.json(await studentsService.getStudent(uuidParam(req)));
});

studentsRouter.patch("/:id", authorize("admin"), async (req, res) => {
  const input = updateStudentSchema.parse(req.body);
  res.json(await studentsService.updateStudent(uuidParam(req), input));
});

studentsRouter.delete("/:id", authorize("admin"), async (req, res) => {
  await studentsService.removeStudent(uuidParam(req));
  res.status(204).end();
});
