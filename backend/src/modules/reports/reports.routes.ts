import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess, requireStaff } from "../../utils/scope";
import {
  createGradeBandSchema,
  markSheetQuerySchema,
  reportCardQuerySchema,
  updateGradeBandSchema,
} from "./reports.schema";
import * as service from "./reports.service";

export const reportsRouter = Router();

reportsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /reports/grade-bands:
 *   get:
 *     tags: [Reports]
 *     summary: List the institution's grade scale
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Grade bands (percentage → grade) }
 *   post:
 *     tags: [Reports]
 *     summary: Add a grade band
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [grade, minPercent, maxPercent]
 *             properties:
 *               grade: { type: string, example: "A+" }
 *               minPercent: { type: number, example: 90 }
 *               maxPercent: { type: number, example: 100 }
 *               remark: { type: string, example: "Outstanding" }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Created grade band }
 */
reportsRouter.get("/grade-bands", requirePermission("reports:read"), async (req, res) => {
  res.json(await service.listGradeBands(tenantId(req)));
});

reportsRouter.post(
  "/grade-bands",
  requirePermission("report_cards:generate"),
  async (req, res) => {
    const input = createGradeBandSchema.parse(req.body);
    res.status(201).json(await service.createGradeBand(input, tenantId(req)));
  }
);

/**
 * @openapi
 * /reports/grade-bands/{id}:
 *   patch:
 *     tags: [Reports]
 *     summary: Update a grade band
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated grade band }
 *   delete:
 *     tags: [Reports]
 *     summary: Delete a grade band
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
reportsRouter.patch(
  "/grade-bands/:id",
  requirePermission("report_cards:generate"),
  async (req, res) => {
    const input = updateGradeBandSchema.parse(req.body);
    res.json(await service.updateGradeBand(uuidParam(req), input, tenantId(req)));
  }
);

reportsRouter.delete(
  "/grade-bands/:id",
  requirePermission("report_cards:generate"),
  async (req, res) => {
    await service.deleteGradeBand(uuidParam(req), tenantId(req));
    res.status(204).end();
  }
);

/**
 * @openapi
 * /reports/report-card:
 *   get:
 *     tags: [Reports]
 *     summary: Download a student's report card PDF (owner-scoped)
 *     description: Staff any student; a student only their own; a parent only their linked children.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: examId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF, content: { application/pdf: {} } }
 *       403: { description: Not an accessible student }
 *       404: { description: Exam/student/results not found }
 */
reportsRouter.get(
  "/report-card",
  requirePermission("report_cards:read"),
  async (req, res) => {
    const { examId, studentId } = reportCardQuerySchema.parse(req.query);
    assertStudentAccess(await accessibleStudentIds(req), studentId);
    const pdf = await service.reportCardBuffer(examId, studentId, tenantId(req));
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="report-card-${studentId}.pdf"`)
      .send(pdf);
  }
);

/**
 * @openapi
 * /reports/mark-sheet:
 *   get:
 *     tags: [Reports]
 *     summary: Download a class/section mark-sheet PDF (staff)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: examId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: sectionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF, content: { application/pdf: {} } }
 *       404: { description: Exam/section not found }
 */
reportsRouter.get(
  "/mark-sheet",
  requirePermission("mark_sheets:export"),
  async (req, res) => {
    requireStaff(req); // class-wide export is staff-only
    const { examId, sectionId } = markSheetQuerySchema.parse(req.query);
    const pdf = await service.markSheetBuffer(examId, sectionId, tenantId(req));
    res
      .type("application/pdf")
      .set("Content-Disposition", `attachment; filename="mark-sheet-${sectionId}.pdf"`)
      .send(pdf);
  }
);
