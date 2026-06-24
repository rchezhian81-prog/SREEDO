import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createQuizSchema,
  updateQuizSchema,
  listQuizzesQuerySchema,
  createQuestionSchema,
  updateQuestionSchema,
} from "./quizzes.schema";
import * as service from "./quizzes.service";

// Quiz authoring — admins & teachers only, tenant-scoped.
// (Students attempt published quizzes through the portal router.)
export const quizzesRouter = Router();
quizzesRouter.use(authenticate, requireTenant, authorize("admin", "teacher"));

/**
 * @openapi
 * /quizzes:
 *   get:
 *     tags: [Quizzes]
 *     summary: List quizzes (filter by class / subject / published)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: classId, schema: { type: string, format: uuid } }
 *       - { in: query, name: subjectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: published, schema: { type: string, enum: ["true", "false"] } }
 *     responses:
 *       200: { description: Paginated quizzes }
 *   post:
 *     tags: [Quizzes]
 *     summary: Create a quiz (admin / teacher)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               classId: { type: string, format: uuid }
 *               subjectId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created quiz }
 */
quizzesRouter.get("/", async (req, res) => {
  const params = listQuizzesQuerySchema.parse(req.query);
  res.json(await service.listQuizzes(parsePagination(params), params, tenantId(req)));
});

quizzesRouter.post("/", async (req, res) => {
  const input = createQuizSchema.parse(req.body);
  res.status(201).json(await service.createQuiz(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /quizzes/{id}:
 *   get:
 *     tags: [Quizzes]
 *     summary: Get a quiz with its questions (answers included, staff view)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Quiz with questions }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Quizzes]
 *     summary: Update a quiz (title / description / class / subject / publish)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated quiz }
 *   delete:
 *     tags: [Quizzes]
 *     summary: Delete a quiz
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
quizzesRouter.get("/:id", async (req, res) => {
  res.json(await service.getQuiz(uuidParam(req), tenantId(req)));
});

quizzesRouter.patch("/:id", async (req, res) => {
  const input = updateQuizSchema.parse(req.body);
  res.json(await service.updateQuiz(uuidParam(req), input, tenantId(req)));
});

quizzesRouter.delete("/:id", async (req, res) => {
  await service.deleteQuiz(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /quizzes/{id}/questions:
 *   post:
 *     tags: [Quizzes]
 *     summary: Add a question to a quiz
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [questionText, optionA, optionB, correctOption]
 *             properties:
 *               questionText: { type: string }
 *               optionA: { type: string }
 *               optionB: { type: string }
 *               optionC: { type: string }
 *               optionD: { type: string }
 *               correctOption: { type: string, enum: [A, B, C, D] }
 *               marks: { type: integer }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Quiz with the new question }
 */
quizzesRouter.post("/:id/questions", async (req, res) => {
  const input = createQuestionSchema.parse(req.body);
  res.status(201).json(await service.addQuestion(uuidParam(req), input, tenantId(req)));
});

/**
 * @openapi
 * /quizzes/questions/{questionId}:
 *   patch:
 *     tags: [Quizzes]
 *     summary: Update a question
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: questionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Quiz with the updated question }
 *   delete:
 *     tags: [Quizzes]
 *     summary: Delete a question
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: questionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
quizzesRouter.patch("/questions/:questionId", async (req, res) => {
  const input = updateQuestionSchema.parse(req.body);
  res.json(await service.updateQuestion(uuidParam(req, "questionId"), input, tenantId(req)));
});

quizzesRouter.delete("/questions/:questionId", async (req, res) => {
  await service.deleteQuestion(uuidParam(req, "questionId"), tenantId(req));
  res.status(204).end();
});
