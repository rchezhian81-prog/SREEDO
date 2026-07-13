import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { requireTenant, tenantId } from "../../middleware/tenant";
import {
  accessibleStudentIds,
  assertStudentAccess,
  requireStaff,
} from "../../utils/scope";
import {
  assertSectionInTeacherScope,
  assertStudentsInTeacherScope,
  resolveTeacherScope,
  scopedSectionIds,
} from "../../utils/teacher-scope";
import { createExamSchema, upsertResultsSchema } from "./exams.schema";
import * as examsService from "./exams.service";

export const examsRouter = Router();

examsRouter.use(authenticate, requireTenant);

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
examsRouter.get("/", async (req, res) => {
  res.json(await examsService.listExams(tenantId(req)));
});

examsRouter.post("/", requirePermission("exams:manage"), async (req, res) => {
  const input = createExamSchema.parse(req.body);
  res.status(201).json(await examsService.createExam(input, tenantId(req)));
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
  requireStaff(req); // exam-wide / section results are staff-only
  const { sectionId } = z
    .object({ sectionId: z.string().uuid().optional() })
    .parse(req.query);
  // A scoped teacher sees only their own sections' results: a foreign section is
  // a 403; an unfiltered request is narrowed to the sections they own.
  const scope = await resolveTeacherScope(req);
  await assertSectionInTeacherScope(req, scope, sectionId, "exams:results");
  res.json(
    await examsService.examResults(
      uuidParam(req),
      sectionId,
      tenantId(req),
      scopedSectionIds(scope)
    )
  );
});

examsRouter.post(
  "/:id/results",
  requirePermission("exams:enter_marks"),
  async (req, res) => {
    const input = upsertResultsSchema.parse(req.body);
    const scope = await resolveTeacherScope(req);
    await assertStudentsInTeacherScope(
      req,
      scope,
      input.results.map((r) => r.studentId),
      "exams:enter_marks",
      tenantId(req)
    );
    res.json(
      await examsService.upsertResults(uuidParam(req), input, tenantId(req))
    );
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
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await examsService.studentReport(studentId, tenantId(req)));
});
