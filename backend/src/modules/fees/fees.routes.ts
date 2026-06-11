import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { parsePagination } from "../../utils/pagination";
import {
  createFeeStructureSchema,
  createInvoiceSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
} from "./fees.schema";
import * as feesService from "./fees.service";

export const feesRouter = Router();

feesRouter.use(authenticate);

const billing = authorize("admin", "accountant");

/**
 * @openapi
 * /fees/structures:
 *   get:
 *     tags: [Fees]
 *     summary: List fee structures
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Fee structures }
 *   post:
 *     tags: [Fees]
 *     summary: Create a fee structure (admin/accountant)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, amount]
 *             properties:
 *               name: { type: string, example: "Term 1 Tuition" }
 *               classId: { type: string, format: uuid }
 *               academicYearId: { type: string, format: uuid }
 *               amount: { type: number }
 *               frequency: { type: string, enum: [one_time, monthly, term, annual] }
 *     responses:
 *       201: { description: Created fee structure }
 */
feesRouter.get("/structures", async (_req, res) => {
  res.json(await feesService.listFeeStructures());
});

feesRouter.post("/structures", billing, async (req, res) => {
  const input = createFeeStructureSchema.parse(req.body);
  res.status(201).json(await feesService.createFeeStructure(input));
});

/**
 * @openapi
 * /fees/invoices:
 *   get:
 *     tags: [Fees]
 *     summary: List invoices
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: studentId, schema: { type: string, format: uuid } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, partially_paid, paid, cancelled] } }
 *     responses:
 *       200: { description: Paginated invoices with paid amounts }
 *   post:
 *     tags: [Fees]
 *     summary: Raise an invoice for a student (admin/accountant)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, description, amountDue, dueDate]
 *             properties:
 *               studentId: { type: string, format: uuid }
 *               feeStructureId: { type: string, format: uuid }
 *               description: { type: string }
 *               amountDue: { type: number }
 *               dueDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created invoice }
 */
feesRouter.get("/invoices", async (req, res) => {
  const queryParams = listInvoicesQuerySchema.parse(req.query);
  const result = await feesService.listInvoices(parsePagination(queryParams), {
    studentId: queryParams.studentId,
    status: queryParams.status,
  });
  res.json(result);
});

feesRouter.post("/invoices", billing, async (req, res) => {
  const input = createInvoiceSchema.parse(req.body);
  res.status(201).json(await feesService.createInvoice(input));
});

/**
 * @openapi
 * /fees/invoices/{id}:
 *   get:
 *     tags: [Fees]
 *     summary: Get an invoice with its payment history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Invoice with payments }
 */
feesRouter.get("/invoices/:id", async (req, res) => {
  res.json(await feesService.getInvoice(uuidParam(req)));
});

/**
 * @openapi
 * /fees/invoices/{id}/payments:
 *   post:
 *     tags: [Fees]
 *     summary: Record a payment against an invoice (admin/accountant)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number }
 *               method: { type: string, enum: [cash, card, bank_transfer, upi, cheque, online] }
 *               reference: { type: string }
 *     responses:
 *       200: { description: Updated invoice; emails a receipt to the guardian when SMTP is configured }
 *       400: { description: Amount exceeds outstanding balance }
 */
feesRouter.post("/invoices/:id/payments", billing, async (req, res) => {
  const input = recordPaymentSchema.parse(req.body);
  res.json(
    await feesService.recordPayment(uuidParam(req), input, req.user!.id)
  );
});

/**
 * @openapi
 * /fees/summary:
 *   get:
 *     tags: [Fees]
 *     summary: Collection totals and outstanding balance
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Totals }
 */
feesRouter.get("/summary", async (_req, res) => {
  res.json(await feesService.feeSummary());
});
