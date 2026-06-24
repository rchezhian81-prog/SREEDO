import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import * as portalService from "./portal.service";
import * as disciplinaryService from "../disciplinary/disciplinary.service";
import * as messService from "../mess/mess.service";
import * as studyMaterialsService from "../studymaterials/studymaterials.service";
import * as quizzesService from "../quizzes/quizzes.service";
import { submitAttemptSchema } from "../quizzes/quizzes.schema";

export const portalRouter = Router();

// Portal is for students & parents only; staff use the main dashboard.
// Every handler is owner-scoped: a student sees only self, a parent only their
// linked children (accessibleStudentIds + assertStudentAccess).
portalRouter.use(authenticate, requireTenant, authorize("student", "parent"));

/**
 * @openapi
 * /portal/mess-menu:
 *   get:
 *     tags: [Portal]
 *     summary: This week's cafeteria / mess menu for the caller's institution
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Weekly menu items ordered by day & meal }
 */
portalRouter.get("/mess-menu", async (req, res) => {
  res.json(await messService.listWeeklyMenu(tenantId(req)));
});

/**
 * @openapi
 * /portal/children:
 *   get:
 *     tags: [Portal]
 *     summary: The students the caller may view (self for a student, children for a parent)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Student cards with class/section and relationship }
 */
portalRouter.get("/children", async (req, res) => {
  const ids = (await accessibleStudentIds(req)) ?? [];
  res.json(await portalService.listChildren(ids, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/materials:
 *   get:
 *     tags: [Portal]
 *     summary: Study materials for an accessible student's class (+ school-wide)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Study materials list }
 *       403: { description: Not an accessible student }
 */
portalRouter.get("/students/:studentId/materials", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await studyMaterialsService.listMaterialsForStudent(studentId, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/quizzes:
 *   get:
 *     tags: [Portal]
 *     summary: Published quizzes available to an accessible student (with attempt status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Quizzes with attempt score where attempted }
 *       403: { description: Not an accessible student }
 */
portalRouter.get("/students/:studentId/quizzes", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await quizzesService.listStudentQuizzes(studentId, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/quizzes/{quizId}:
 *   get:
 *     tags: [Portal]
 *     summary: A quiz to take (answers hidden until attempted, then revealed for review)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: quizId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Quiz with questions (+ result if already attempted) }
 *       403: { description: Not an accessible student }
 *       404: { description: Quiz not available }
 */
portalRouter.get("/students/:studentId/quizzes/:quizId", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(
    await quizzesService.getQuizForStudent(uuidParam(req, "quizId"), studentId, tenantId(req))
  );
});

/**
 * @openapi
 * /portal/students/{studentId}/quizzes/{quizId}/attempt:
 *   post:
 *     tags: [Portal]
 *     summary: Submit a quiz attempt (auto-graded; one attempt per student)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: quizId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: object
 *                 additionalProperties: { type: string, enum: [A, B, C, D] }
 *     responses:
 *       201: { description: "{ attemptId, score, total }" }
 *       409: { description: Already attempted }
 */
portalRouter.post("/students/:studentId/quizzes/:quizId/attempt", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  const input = submitAttemptSchema.parse(req.body);
  res
    .status(201)
    .json(
      await quizzesService.submitAttempt(uuidParam(req, "quizId"), studentId, tenantId(req), input)
    );
});

/**
 * @openapi
 * /portal/students/{studentId}/summary:
 *   get:
 *     tags: [Portal]
 *     summary: Profile + attendance + fee summary for an accessible student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ profile, attendance, fees }" }
 *       403: { description: Not an accessible student }
 *       404: { description: Student not found in this institution }
 */
portalRouter.get("/students/:studentId/summary", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await portalService.studentSummary(studentId, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/timetable:
 *   get:
 *     tags: [Portal]
 *     summary: The accessible student's class timetable
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Timetable entries for the student's section }
 *       403: { description: Not an accessible student }
 */
portalRouter.get("/students/:studentId/timetable", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await portalService.studentTimetable(studentId, tenantId(req)));
});

/**
 * @openapi
 * /portal/students/{studentId}/disciplinary:
 *   get:
 *     tags: [Portal]
 *     summary: The accessible student's disciplinary records (only when the institution has enabled portal visibility)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Disciplinary records (owner-scoped) }
 *       403: { description: Not an accessible student / portal visibility disabled }
 */
portalRouter.get(
  "/students/:studentId/disciplinary",
  requirePermission("disciplinary:portal_read"),
  async (req, res) => {
    const studentId = uuidParam(req, "studentId");
    assertStudentAccess(await accessibleStudentIds(req), studentId);
    res.json(await disciplinaryService.portalStudentRecords(studentId, tenantId(req)));
  }
);
