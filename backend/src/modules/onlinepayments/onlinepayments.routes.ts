import type { Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import {
  createOrderSchema,
  listOrdersQuerySchema,
  settingsPatchSchema,
} from "./onlinepayments.schema";
import * as service from "./onlinepayments.service";

export const onlinePaymentsRouter = Router();

/**
 * @openapi
 * /online-payments/webhook:
 *   post:
 *     tags: [Online Payments]
 *     summary: Payment gateway webhook (signature-verified, idempotent — no auth)
 *     description: Called by the gateway, not the browser. The raw body is HMAC-verified.
 *     responses:
 *       200: { description: Acknowledged (also for duplicates/unmatched events) }
 *       401: { description: Invalid signature }
 *       503: { description: Gateway not configured }
 */
// Public, unauthenticated webhook — registered BEFORE the auth middleware so the
// gateway can reach it. Idempotency + signature verification live in the service.
onlinePaymentsRouter.post("/webhook", async (req, res) => {
  const signature =
    (req.header("x-payment-signature") ||
      req.header("x-webhook-signature") ||
      req.header("x-razorpay-signature") ||
      req.header("stripe-signature")) ??
    undefined;
  res.json(await service.processWebhook(req.rawBody, signature, req.body));
});

// Everything below requires an authenticated, tenant-scoped caller.
onlinePaymentsRouter.use(authenticate, requireTenant);

const canRead = requirePermission("online_payments:read");
const canCreate = requirePermission("online_payments:create");
const canRefund = requirePermission("online_payments:refund");
const canSettings = requirePermission("online_payments:settings");

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res
    .type("application/pdf")
    .set("Content-Disposition", `inline; filename="${filename}"`)
    .send(buffer);
}

/**
 * @openapi
 * /online-payments/settings:
 *   get:
 *     tags: [Online Payments]
 *     summary: Gateway status for the institution (no secret keys are returned)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ configured, provider, currency, institutionEnabled, enabled }" }
 *   patch:
 *     tags: [Online Payments]
 *     summary: Enable/disable online payments for the institution (feature flag)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [enabled], properties: { enabled: { type: boolean } } }
 *     responses:
 *       200: { description: Updated status }
 */
onlinePaymentsRouter.get("/settings", canSettings, async (req, res) => {
  res.json(await service.gatewayStatus(tenantId(req)));
});

onlinePaymentsRouter.patch("/settings", canSettings, async (req, res) => {
  const { enabled } = settingsPatchSchema.parse(req.body);
  res.json(await service.setInstitutionEnabled(tenantId(req), enabled));
});

/**
 * @openapi
 * /online-payments:
 *   get:
 *     tags: [Online Payments]
 *     summary: List payment orders (owner-scoped for student/parent)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: invoiceId, schema: { type: string, format: uuid } }
 *       - { in: query, name: studentId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment orders }
 *   post:
 *     tags: [Online Payments]
 *     summary: Create an online payment order for a pending invoice
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoiceId]
 *             properties:
 *               invoiceId: { type: string, format: uuid }
 *               amount: { type: number, description: "Optional; must equal the outstanding balance" }
 *     responses:
 *       201: { description: Created order with hosted checkout URL }
 *       400: { description: Amount mismatch / already paid }
 *       403: { description: Not an accessible student }
 *       503: { description: Gateway not configured / disabled }
 */
onlinePaymentsRouter.get("/", canRead, async (req, res) => {
  const filters = listOrdersQuerySchema.parse(req.query);
  res.json(await service.listOrders(req, tenantId(req), filters));
});

onlinePaymentsRouter.post("/", canCreate, async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  res.status(201).json(await service.createOrder(req, input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /online-payments/{id}:
 *   get:
 *     tags: [Online Payments]
 *     summary: Get a payment order (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment order }
 *       403: { description: Not an accessible student }
 *       404: { description: Not found }
 */
onlinePaymentsRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getOrder(req, uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /online-payments/{id}/receipt:
 *   get:
 *     tags: [Online Payments]
 *     summary: Download the fee receipt PDF for a successful payment (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF }
 *       400: { description: Payment not successful yet }
 *       403: { description: Not an accessible student }
 */
onlinePaymentsRouter.get("/:id/receipt", canRead, async (req, res) => {
  const buf = await service.orderReceipt(req, uuidParam(req), tenantId(req));
  sendPdf(res, buf, "fee-receipt.pdf");
});

/**
 * @openapi
 * /online-payments/{id}/refund:
 *   post:
 *     tags: [Online Payments]
 *     summary: Initiate a gateway refund for a successful payment (admin/accountant)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Refunded order }
 *       400: { description: Not refundable / unsupported }
 */
onlinePaymentsRouter.post("/:id/refund", canRefund, async (req, res) => {
  res.json(await service.refundOrder(uuidParam(req), tenantId(req)));
});
