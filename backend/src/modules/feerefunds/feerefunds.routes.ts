import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createRefundSchema,
  listRefundsQuerySchema,
  listPaymentsQuerySchema,
} from "./feerefunds.schema";
import * as service from "./feerefunds.service";

// Fee refunds — tenant-scoped. Reads need fees:manage; the money-reversal writes
// need the high-risk fees:reverse permission (reason-required at the schema).
export const feeRefundsRouter = Router();
feeRefundsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /fee-refunds/payments:
 *   get:
 *     tags: [Fee Refunds]
 *     summary: List recent payments with their refundable balance
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Payments with refundable amount }
 */
feeRefundsRouter.get("/payments", requirePermission("fees:manage"), async (req, res) => {
  const { search } = listPaymentsQuerySchema.parse(req.query);
  res.json(await service.listRefundablePayments(tenantId(req), search));
});

/**
 * @openapi
 * /fee-refunds:
 *   get:
 *     tags: [Fee Refunds]
 *     summary: List fee refunds (search by invoice / student)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated refunds }
 *   post:
 *     tags: [Fee Refunds]
 *     summary: Record a refund against a payment
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId, amount]
 *             properties:
 *               paymentId: { type: string, format: uuid }
 *               amount: { type: number }
 *               reason: { type: string }
 *               method: { type: string, enum: [cash, card, bank_transfer, upi, cheque, online] }
 *     responses:
 *       201: { description: Created refund }
 *       400: { description: Refund exceeds refundable balance }
 *       404: { description: Payment not found }
 */
feeRefundsRouter.get("/", requirePermission("fees:manage"), async (req, res) => {
  const params = listRefundsQuerySchema.parse(req.query);
  res.json(await service.listRefunds(parsePagination(params), params, tenantId(req)));
});

feeRefundsRouter.post("/", requirePermission("fees:reverse"), async (req, res) => {
  const input = createRefundSchema.parse(req.body);
  res.status(201).json(await service.createRefund(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /fee-refunds/{id}:
 *   delete:
 *     tags: [Fee Refunds]
 *     summary: Delete a refund record
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
feeRefundsRouter.delete("/:id", requirePermission("fees:reverse"), async (req, res) => {
  await service.deleteRefund(uuidParam(req), tenantId(req));
  res.status(204).end();
});
