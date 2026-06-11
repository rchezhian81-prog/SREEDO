import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import {
  createAcademicYearSchema,
  createClassSchema,
  createSectionSchema,
  createSubjectSchema,
} from "./academics.schema";
import * as academicsService from "./academics.service";

export const academicsRouter = Router();

academicsRouter.use(authenticate);

/**
 * @openapi
 * /academic-years:
 *   get:
 *     tags: [Academics]
 *     summary: List academic years
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Academic years, newest first }
 *   post:
 *     tags: [Academics]
 *     summary: Create an academic year (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, startDate, endDate]
 *             properties:
 *               name: { type: string, example: "2026-2027" }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               isCurrent: { type: boolean }
 *     responses:
 *       201: { description: Created academic year }
 */
academicsRouter.get("/academic-years", async (_req, res) => {
  res.json(await academicsService.listAcademicYears());
});

academicsRouter.post(
  "/academic-years",
  authorize("admin"),
  async (req, res) => {
    const input = createAcademicYearSchema.parse(req.body);
    res.status(201).json(await academicsService.createAcademicYear(input));
  }
);

/**
 * @openapi
 * /classes:
 *   get:
 *     tags: [Academics]
 *     summary: List classes with their sections and student counts
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Classes ordered by grade level }
 *   post:
 *     tags: [Academics]
 *     summary: Create a class (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, gradeLevel]
 *             properties:
 *               name: { type: string, example: "Grade 5" }
 *               gradeLevel: { type: integer, example: 5 }
 *     responses:
 *       201: { description: Created class }
 */
academicsRouter.get("/classes", async (_req, res) => {
  res.json(await academicsService.listClasses());
});

academicsRouter.post("/classes", authorize("admin"), async (req, res) => {
  const input = createClassSchema.parse(req.body);
  res.status(201).json(await academicsService.createClass(input));
});

/**
 * @openapi
 * /classes/{id}:
 *   delete:
 *     tags: [Academics]
 *     summary: Delete a class and its sections (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
academicsRouter.delete("/classes/:id", authorize("admin"), async (req, res) => {
  await academicsService.removeClass(uuidParam(req));
  res.status(204).end();
});

/**
 * @openapi
 * /classes/{classId}/sections:
 *   post:
 *     tags: [Academics]
 *     summary: Add a section to a class (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: classId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "A" }
 *               homeroomTeacherId: { type: string, format: uuid }
 *               capacity: { type: integer }
 *     responses:
 *       201: { description: Created section }
 */
academicsRouter.post(
  "/classes/:classId/sections",
  authorize("admin"),
  async (req, res) => {
    const input = createSectionSchema.parse(req.body);
    res
      .status(201)
      .json(await academicsService.createSection(uuidParam(req, "classId"), input));
  }
);

/**
 * @openapi
 * /sections/{id}:
 *   delete:
 *     tags: [Academics]
 *     summary: Delete a section (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
academicsRouter.delete(
  "/sections/:id",
  authorize("admin"),
  async (req, res) => {
    await academicsService.removeSection(uuidParam(req));
    res.status(204).end();
  }
);

/**
 * @openapi
 * /subjects:
 *   get:
 *     tags: [Academics]
 *     summary: List subjects
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Subjects ordered by name }
 *   post:
 *     tags: [Academics]
 *     summary: Create a subject (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string, example: "Mathematics" }
 *               code: { type: string, example: "MATH" }
 *     responses:
 *       201: { description: Created subject }
 */
academicsRouter.get("/subjects", async (_req, res) => {
  res.json(await academicsService.listSubjects());
});

academicsRouter.post("/subjects", authorize("admin"), async (req, res) => {
  const input = createSubjectSchema.parse(req.body);
  res.status(201).json(await academicsService.createSubject(input));
});

/**
 * @openapi
 * /subjects/{id}:
 *   delete:
 *     tags: [Academics]
 *     summary: Delete a subject (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
academicsRouter.delete("/subjects/:id", authorize("admin"), async (req, res) => {
  await academicsService.removeSubject(uuidParam(req));
  res.status(204).end();
});
