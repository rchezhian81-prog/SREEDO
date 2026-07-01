import { Router } from "express";
import type { Request } from "express";
import * as service from "./saaspayments.service";

/**
 * PUBLIC Razorpay webhook for platform SaaS invoices. Mounted at /platform BEFORE
 * the super-admin-guarded platform routers, and it declares ONLY this one path so
 * every other /platform/* request falls through untouched. The handler verifies
 * the HMAC signature and de-dupes by event id inside the service before anything
 * is trusted, so no auth middleware is appropriate (the caller is Razorpay).
 */
export const saasPaymentsWebhookRouter = Router();

/**
 * @openapi
 * /platform/payments/webhook:
 *   post:
 *     tags: [Platform]
 *     summary: "Razorpay webhook for SaaS-invoice payments (HMAC-verified, idempotent). Public — no auth."
 *     responses:
 *       200: { description: "Processed (or duplicate/ignored)" }
 *       401: { description: "Invalid signature" }
 *       503: { description: "Gateway webhook secret not configured" }
 */
saasPaymentsWebhookRouter.post("/payments/webhook", async (req: Request, res) => {
  const signature =
    req.header("x-razorpay-signature") || req.header("x-webhook-signature") || undefined;
  const eventId = req.header("x-razorpay-event-id") || undefined;
  const result = await service.processWebhook(req.rawBody, signature, eventId, req.body);
  res.json(result);
});
