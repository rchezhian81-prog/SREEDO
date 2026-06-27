import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import { createPollSchema, updatePollSchema, listPollsQuerySchema } from "./polls.schema";
import * as service from "./polls.service";

// Poll authoring — admins & teachers only, tenant-scoped.
// (Students vote on published polls through the portal router.)
export const pollsRouter = Router();
pollsRouter.use(authenticate, requireTenant, authorize("admin", "teacher"));

/**
 * @openapi
 * /polls:
 *   get:
 *     tags: [Polls]
 *     summary: List polls (filter by class / published)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: classId, schema: { type: string, format: uuid } }
 *       - { in: query, name: published, schema: { type: string, enum: ["true", "false"] } }
 *     responses:
 *       200: { description: Paginated polls }
 *   post:
 *     tags: [Polls]
 *     summary: Create a poll with options
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question, options]
 *             properties:
 *               question: { type: string }
 *               description: { type: string }
 *               classId: { type: string, format: uuid }
 *               closesAt: { type: string, format: date-time }
 *               options: { type: array, items: { type: string }, minItems: 2 }
 *     responses:
 *       201: { description: Created poll with options }
 */
pollsRouter.get("/", async (req, res) => {
  const params = listPollsQuerySchema.parse(req.query);
  res.json(await service.listPolls(parsePagination(params), params, tenantId(req)));
});

pollsRouter.post("/", async (req, res) => {
  const input = createPollSchema.parse(req.body);
  res.status(201).json(await service.createPoll(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /polls/{id}:
 *   get:
 *     tags: [Polls]
 *     summary: Get a poll with options and vote counts
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Poll with results }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Polls]
 *     summary: Update a poll (question / class / publish / close)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated poll }
 *   delete:
 *     tags: [Polls]
 *     summary: Delete a poll
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
pollsRouter.get("/:id", async (req, res) => {
  res.json(await service.getPoll(uuidParam(req), tenantId(req)));
});

pollsRouter.patch("/:id", async (req, res) => {
  const input = updatePollSchema.parse(req.body);
  res.json(await service.updatePoll(uuidParam(req), input, tenantId(req)));
});

pollsRouter.delete("/:id", async (req, res) => {
  await service.deletePoll(uuidParam(req), tenantId(req));
  res.status(204).end();
});
