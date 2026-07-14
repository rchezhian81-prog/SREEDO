import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createRefundSchema,
  listRefundsQuerySchema,
  listPaymentsQuerySchema,
  voidRefundSchema,
} from "./feerefunds.schema";
import * as service from "./feerefunds.service";

// Fee refunds — tenant-scoped. Reads need fees:manage; the money-reversal writes
// (create / void / reconcile) need the high-risk fees:reverse permission
// (reason-required at the schema). Every reversal is audited.
export const feeRefundsRouter = Router();
feeRefundsRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip ?? null,
});

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
 *     summary: Record a refund against a payment (reconciles the invoice ledger)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId, amount, reason]
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
  const refund = await service.createRefund(input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "fee_refund.created",
    targetType: "payment_refund",
    targetId: refund.id as string,
    institutionId: tenantId(req),
    detail: { paymentId: input.paymentId, amount: input.amount, invoiceNo: refund.invoiceNo },
  });
  res.status(201).json(refund);
});

/**
 * @openapi
 * /fee-refunds/reconcile:
 *   post:
 *     tags: [Fee Refunds]
 *     summary: Idempotently reconcile every invoice that has refunds (backfill)
 *     description: >
 *       Recomputes each affected invoice's net paid amount and status from the
 *       payments/refunds ledger. Non-destructive (no refund rows change) and
 *       idempotent (re-running adjusts nothing). Returns a report of changes.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ scanned, adjusted: [...] }" }
 */
feeRefundsRouter.post("/reconcile", requirePermission("fees:reverse"), async (req, res) => {
  const report = await service.reconcileAll(tenantId(req));
  await recordAudit(actorOf(req), {
    action: "fee_refund.reconcile",
    targetType: "fee_ledger",
    targetId: null,
    institutionId: tenantId(req),
    detail: { scanned: report.scanned, adjusted: report.adjusted.length },
  });
  for (const change of report.adjusted) {
    await recordAudit(actorOf(req), {
      action: "fee_refund.reconcile_invoice",
      targetType: "invoice",
      targetId: change.invoiceId,
      institutionId: tenantId(req),
      detail: {
        invoiceNo: change.invoiceNo,
        oldPaid: change.oldPaid, newPaid: change.newPaid,
        oldStatus: change.oldStatus, newStatus: change.newStatus,
      },
    });
  }
  res.json(report);
});

/**
 * @openapi
 * /fee-refunds/{id}/void:
 *   post:
 *     tags: [Fee Refunds]
 *     summary: Void a refund (soft — preserves the record, restores the ledger)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Voided refund }
 *       400: { description: Already voided }
 *       404: { description: Refund not found }
 */
feeRefundsRouter.post("/:id/void", requirePermission("fees:reverse"), async (req, res) => {
  const id = uuidParam(req);
  const { reason } = voidRefundSchema.parse(req.body);
  const refund = await service.voidRefund(id, reason, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "fee_refund.voided",
    targetType: "payment_refund",
    targetId: id,
    institutionId: tenantId(req),
    detail: { reason, invoiceNo: refund.invoiceNo, amount: refund.amount },
  });
  res.json(refund);
});
