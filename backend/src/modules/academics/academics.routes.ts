import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import {
  createAcademicYearSchema,
  createClassSchema,
  createSectionSchema,
  createSubjectSchema,
} from "./academics.schema";
import * as academicsService from "./academics.service";

export const academicsRouter = Router();

// Per-route guards (not router.use): this router is mounted at "/", so a
// router-level .use() would run for every /api/v1 request — including sibling
// routers' paths like /institutions — and wrongly reject them.
const guard = [authenticate, requireTenant];

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
academicsRouter.get("/academic-years", ...guard, async (req, res) => {
  res.json(await academicsService.listAcademicYears(tenantId(req)));
});

academicsRouter.post(
  "/academic-years",
  ...guard,
  authorize("admin"),
  async (req, res) => {
    const input = createAcademicYearSchema.parse(req.body);
    res
      .status(201)
      .json(await academicsService.createAcademicYear(input, tenantId(req)));
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
academicsRouter.get("/classes", ...guard, async (req, res) => {
  res.json(await academicsService.listClasses(tenantId(req)));
});

academicsRouter.post("/classes", ...guard, authorize("admin"), async (req, res) => {
  const input = createClassSchema.parse(req.body);
  res.status(201).json(await academicsService.createClass(input, tenantId(req)));
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
academicsRouter.delete("/classes/:id", ...guard, authorize("admin"), async (req, res) => {
  await academicsService.removeClass(uuidParam(req), tenantId(req));
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
  ...guard,
  authorize("admin"),
  async (req, res) => {
    const input = createSectionSchema.parse(req.body);
    res
      .status(201)
      .json(
        await academicsService.createSection(
          uuidParam(req, "classId"),
          input,
          tenantId(req)
        )
      );
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
  ...guard,
  authorize("admin"),
  async (req, res) => {
    await academicsService.removeSection(uuidParam(req), tenantId(req));
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
academicsRouter.get("/subjects", ...guard, async (req, res) => {
  res.json(await academicsService.listSubjects(tenantId(req)));
});

academicsRouter.post("/subjects", ...guard, authorize("admin"), async (req, res) => {
  const input = createSubjectSchema.parse(req.body);
  res
    .status(201)
    .json(await academicsService.createSubject(input, tenantId(req)));
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
academicsRouter.delete("/subjects/:id", ...guard, authorize("admin"), async (req, res) => {
  await academicsService.removeSubject(uuidParam(req), tenantId(req));
  res.status(204).end();
});
