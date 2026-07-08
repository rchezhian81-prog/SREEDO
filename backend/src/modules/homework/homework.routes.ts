import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { uploadSingle } from "../../utils/upload";
import {
  createHomeworkSchema,
  listHomeworkQuerySchema,
  reviewSchema,
  submitHomeworkSchema,
  updateHomeworkSchema,
} from "./homework.schema";
import * as service from "./homework.service";

export const homeworkRouter = Router();

homeworkRouter.use(authenticate, requireTenant);

const sanitize = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);

/**
 * @openapi
 * /homework:
 *   get:
 *     tags: [Homework]
 *     summary: List homework (owner-scoped — staff all, student/parent their sections)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: semesterId, schema: { type: string, format: uuid } }
 *       - { in: query, name: batchId, schema: { type: string, format: uuid } }
 *       - { in: query, name: subjectId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Homework list }
 *   post:
 *     tags: [Homework]
 *     summary: Create homework for a subject and one cohort — a section (school) or a semester (college) (teacher)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subjectId, title]
 *             properties:
 *               sectionId: { type: string, format: uuid, description: "School cohort — provide exactly one of sectionId or semesterId" }
 *               semesterId: { type: string, format: uuid, description: "College cohort — provide exactly one of sectionId or semesterId" }
 *               batchId: { type: string, format: uuid, description: "Optional — narrows a semester target to one batch within it" }
 *               subjectId: { type: string, format: uuid }
 *               title: { type: string }
 *               description: { type: string }
 *               instructions: { type: string }
 *               dueDate: { type: string, format: date }
 *               maxMarks: { type: number }
 *     responses:
 *       201: { description: Created homework (notifies the cohort) }
 */
homeworkRouter.get("/", requirePermission("homework:read"), async (req, res) => {
  const filters = listHomeworkQuerySchema.parse(req.query);
  res.json(await service.listHomework(req, filters, tenantId(req)));
});

homeworkRouter.post("/", requirePermission("homework:create"), async (req, res) => {
  const input = createHomeworkSchema.parse(req.body);
  res.status(201).json(await service.createHomework(input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /homework/{id}:
 *   get:
 *     tags: [Homework]
 *     summary: Homework detail with attachments (+ own submission for a student)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Homework }
 *       403: { description: Not in your section }
 *   patch:
 *     tags: [Homework]
 *     summary: Update homework (teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     tags: [Homework]
 *     summary: Delete homework (teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
homeworkRouter.get("/:id", requirePermission("homework:read"), async (req, res) => {
  res.json(await service.getHomework(req, uuidParam(req), tenantId(req)));
});

homeworkRouter.patch("/:id", requirePermission("homework:update"), async (req, res) => {
  const input = updateHomeworkSchema.parse(req.body);
  res.json(await service.updateHomework(uuidParam(req), input, tenantId(req)));
});

homeworkRouter.delete("/:id", requirePermission("homework:delete"), async (req, res) => {
  await service.deleteHomework(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /homework/{id}/attachments:
 *   post:
 *     tags: [Homework]
 *     summary: Attach a file to homework (teacher; multipart field "file")
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Attachment metadata }
 */
homeworkRouter.post(
  "/:id/attachments",
  requirePermission("homework:update"),
  uploadSingle("file"),
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest("A file is required");
    res
      .status(201)
      .json(await service.addHomeworkAttachment(uuidParam(req), req.file, tenantId(req), req.user!.id));
  }
);

/**
 * @openapi
 * /homework/{id}/submit:
 *   post:
 *     tags: [Homework]
 *     summary: Submit homework (student; multipart — optional text "content" + file)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: "Submission record (id, status, attachment)" }
 *       403: { description: Not your section }
 */
homeworkRouter.post(
  "/:id/submit",
  requirePermission("homework:submit"),
  uploadSingle("file"),
  async (req, res) => {
    const { content } = submitHomeworkSchema.parse(req.body ?? {});
    res
      .status(201)
      .json(await service.submitHomework(req, uuidParam(req), content, req.file, tenantId(req)));
  }
);

/**
 * @openapi
 * /homework/{id}/submissions:
 *   get:
 *     tags: [Homework]
 *     summary: List submissions for a homework (teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Submissions with student + status }
 */
homeworkRouter.get(
  "/:id/submissions",
  requirePermission("homework:review"),
  async (req, res) => {
    res.json(await service.listSubmissions(uuidParam(req), tenantId(req)));
  }
);

/**
 * @openapi
 * /homework/submissions/{sid}/review:
 *   post:
 *     tags: [Homework]
 *     summary: Review/grade a submission (teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: sid, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [submitted, reviewed, completed, late, resubmit] }
 *               marks: { type: number }
 *               remarks: { type: string }
 *     responses:
 *       200: { description: Updated submission }
 */
homeworkRouter.post(
  "/submissions/:sid/review",
  requirePermission("homework:review"),
  async (req, res) => {
    const input = reviewSchema.parse(req.body);
    res.json(
      await service.reviewSubmission(uuidParam(req, "sid"), input, req.user!.id, tenantId(req))
    );
  }
);

/**
 * @openapi
 * /homework/attachments/{docId}/download:
 *   get:
 *     tags: [Homework]
 *     summary: Download a homework/submission attachment (protected, owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: docId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The file bytes }
 *       403: { description: Not permitted }
 *       404: { description: Not found }
 */
homeworkRouter.get(
  "/attachments/:docId/download",
  requirePermission("homework:read"),
  async (req, res) => {
    const { buffer, mimeType, originalName } = await service.downloadAttachment(
      req,
      uuidParam(req, "docId"),
      tenantId(req)
    );
    res
      .type(mimeType)
      .set("Content-Disposition", `inline; filename="${sanitize(originalName)}"`)
      .send(buffer);
  }
);
