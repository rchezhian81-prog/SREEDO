import { Router } from "express";
import { param } from "../../utils/params";
import { z } from "zod";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import * as aiService from "./ai.service";

export const aiRouter = Router();

// requireTenant guarantees a non-null institutionId so the assistant's data
// snapshot and conversation history stay scoped to the caller's tenant.
aiRouter.use(authenticate, authorize("admin", "teacher", "accountant"), requireTenant);

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, "Invalid conversation id")
    .optional(),
});

/**
 * @openapi
 * /ai/assistant:
 *   post:
 *     tags: [AI]
 *     summary: Ask the GPT-4o school assistant (staff roles only)
 *     description: Conversations are persisted in MongoDB when available. Returns 503 when OPENAI_API_KEY is not configured.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *               conversationId: { type: string, description: Continue an existing conversation }
 *     responses:
 *       200: { description: Assistant reply with conversation id }
 *       503: { description: Assistant not configured }
 */
aiRouter.post("/assistant", async (req, res) => {
  const { message, conversationId } = chatSchema.parse(req.body);
  res.json(
    await aiService.chat(req.user!.id, tenantId(req), message, conversationId)
  );
});

/**
 * @openapi
 * /ai/conversations:
 *   get:
 *     tags: [AI]
 *     summary: List the caller's AI conversations
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Conversations, most recent first }
 */
aiRouter.get("/conversations", async (req, res) => {
  res.json(await aiService.listConversations(req.user!.id));
});

/**
 * @openapi
 * /ai/conversations/{id}:
 *   get:
 *     tags: [AI]
 *     summary: Get a conversation with its messages
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Conversation }
 *       404: { description: Not found }
 */
aiRouter.get("/conversations/:id", async (req, res) => {
  res.json(await aiService.getConversation(req.user!.id, param(req, "id")));
});
