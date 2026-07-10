import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireFeatureOptIn } from "../../middleware/feature-flag";
import { requirePermission } from "../../middleware/permissions";
import { copilotRateLimiter } from "../../middleware/rate-limit";
import { copilotAskSchema } from "./copilot.schema";
import * as service from "./copilot.service";

// PR-T11 — GoCampus AI Copilot Phase 1. READ-ONLY conversational assistant.
// Guard stack (all must pass): authenticate → requireTenant →
// requireFeatureOptIn("aiCopilot") [OFF by default — passes only when the
// tenant's settings.featureFlags.aiCopilot === true] →
// requirePermission("ai:copilot") [admin-only by default, migration 0116] →
// copilotRateLimiter [per-user burst cap]. The service additionally enforces a
// per-user daily budget and 503s when OPENAI_API_KEY is unset. Mounted at
// /ai/copilot BEFORE the legacy /ai router, which is untouched.
export const copilotRouter = Router();
copilotRouter.use(
  authenticate,
  requireTenant,
  requireFeatureOptIn("aiCopilot", "AI Copilot"),
  requirePermission("ai:copilot"),
  copilotRateLimiter
);

/**
 * @openapi
 * /ai/copilot:
 *   post:
 *     tags: [AI Copilot]
 *     summary: Ask the read-only copilot (answers cite their sources; never mutates)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               conversationId: { type: string, description: Optional Mongo conversation id }
 *     responses:
 *       200: { description: "Reply + cited sources + retrievers used" }
 *       403: { description: "Feature not enabled for this institution, or missing ai:copilot" }
 *       429: { description: "Per-minute rate limit or daily quota reached" }
 *       503: { description: "OPENAI_API_KEY not configured (safe refusal)" }
 */
copilotRouter.post("/", async (req, res) => {
  const { message, conversationId } = copilotAskSchema.parse(req.body);
  const result = await service.answer(
    req.user!,
    tenantId(req),
    req.ip ?? null,
    message,
    conversationId
  );
  res.json(result);
});
