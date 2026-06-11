import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { createExamSchema, upsertResultsSchema } from "./exams.schema";
import * as examsService from "./exams.service";

export const examsRouter = Router();

examsRouter.use(authenticate);

/**
 * @openapi
 * /exams:
 *   get:
 *     tags: [Exams]
 *     summary: List exams
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Exams, latest first }
 *   post:
 *     tags: [Exams]
 *     summary: Create an exam (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Mid-term 2026" }
 *               academicYearId: { type: string, format: uuid }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created exam }
 */
examsRouter.get("/", async (_req, res) => {
  res.json(await examsService.listExams());
});

examsRouter.post("/", authorize("admin"), async (req, res) => {
  const input = createExamSchema.parse(req.body);
  res.status(201).json(await examsService.createExam(input));
});

/**
 * @openapi
 * /exams/{id}/results:
 *   get:
 *     tags: [Exams]
 *     summary: Results for an exam, optionally filtered by section
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Results }
 *   post:
 *     tags: [Exams]
 *     summary: Upsert results in bulk (admin/teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [results]
 *             properties:
 *               results:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [studentId, subjectId, marksObtained]
 *                   properties:
 *                     studentId: { type: string, format: uuid }
 *                     subjectId: { type: string, format: uuid }
 *                     marksObtained: { type: number }
 *                     maxMarks: { type: number, default: 100 }
 *                     grade: { type: string }
 *                     remarks: { type: string }
 *     responses:
 *       200: { description: Upsert summary }
 */
examsRouter.get("/:id/results", async (req, res) => {
  const { sectionId } = z
    .object({ sectionId: z.string().uuid().optional() })
    .parse(req.query);
  res.json(await examsService.examResults(uuidParam(req), sectionId));
});

examsRouter.post(
  "/:id/results",
  authorize("admin", "teacher"),
  async (req, res) => {
    const input = upsertResultsSchema.parse(req.body);
    res.json(await examsService.upsertResults(uuidParam(req), input));
  }
);

/**
 * @openapi
 * /exams/students/{studentId}/report:
 *   get:
 *     tags: [Exams]
 *     summary: Full mark report for one student across all exams
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Report rows }
 */
examsRouter.get("/students/:studentId/report", async (req, res) => {
  res.json(await examsService.studentReport(uuidParam(req, "studentId")));
});
