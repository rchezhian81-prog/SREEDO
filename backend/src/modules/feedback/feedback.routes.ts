import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createFeedbackSchema,
  updateFeedbackSchema,
  listFeedbackQuerySchema,
  publicFeedbackSchema,
} from "./feedback.schema";
import * as service from "./feedback.service";

export const feedbackRouter = Router();

/**
 * @openapi
 * /feedback/submit:
 *   post:
 *     tags: [Feedback]
 *     summary: Public feedback / grievance submission (no auth), by school code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [institutionCode, subject, message]
 *             properties:
 *               institutionCode: { type: string }
 *               type: { type: string, enum: [feedback, complaint, suggestion, grievance] }
 *               subject: { type: string }
 *               message: { type: string }
 *               submitterName: { type: string }
 *               submitterContact: { type: string }
 *     responses:
 *       201: { description: "Submitted { id, status }" }
 *       404: { description: No school for that code }
 */
feedbackRouter.post("/submit", async (req, res) => {
  const input = publicFeedbackSchema.parse(req.body);
  res.status(201).json(await service.createPublicFeedback(input));
});

// Everything below is institution-admin only, scoped to the tenant.
feedbackRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /feedback:
 *   get:
 *     tags: [Feedback]
 *     summary: List feedback / grievances (filter by type/status, search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: type, schema: { type: string, enum: [feedback, complaint, suggestion, grievance] } }
 *       - { in: query, name: status, schema: { type: string, enum: [open, in_progress, resolved, closed] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated entries }
 *   post:
 *     tags: [Feedback]
 *     summary: Log a feedback / grievance entry (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               type: { type: string, enum: [feedback, complaint, suggestion, grievance] }
 *               subject: { type: string }
 *               message: { type: string }
 *               submitterName: { type: string }
 *               submitterContact: { type: string }
 *     responses:
 *       201: { description: Created entry }
 */
feedbackRouter.get("/", async (req, res) => {
  const params = listFeedbackQuerySchema.parse(req.query);
  res.json(await service.listFeedback(parsePagination(params), params, tenantId(req)));
});

feedbackRouter.post("/", async (req, res) => {
  const input = createFeedbackSchema.parse(req.body);
  res.status(201).json(await service.createFeedback(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /feedback/{id}:
 *   get:
 *     tags: [Feedback]
 *     summary: Get one entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Entry }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Feedback]
 *     summary: Update an entry (status / resolution / fields)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *   delete:
 *     tags: [Feedback]
 *     summary: Delete an entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
feedbackRouter.get("/:id", async (req, res) => {
  res.json(await service.getFeedback(uuidParam(req), tenantId(req)));
});

feedbackRouter.patch("/:id", async (req, res) => {
  const input = updateFeedbackSchema.parse(req.body);
  res.json(await service.updateFeedback(uuidParam(req), input, tenantId(req)));
});

feedbackRouter.delete("/:id", async (req, res) => {
  await service.deleteFeedback(uuidParam(req), tenantId(req));
  res.status(204).end();
});
