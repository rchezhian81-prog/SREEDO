import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createTransactionSchema,
  updateTransactionSchema,
  listTransactionsQuerySchema,
  summaryQuerySchema,
} from "./finance.schema";
import * as service from "./finance.service";

// Accounting ledger — institution-admin only, scoped to the caller's tenant.
export const financeRouter = Router();
financeRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /finance/summary:
 *   get:
 *     tags: [Finance]
 *     summary: Income/expense/net totals + per-category breakdown for a date range
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ income, expense, net, byCategory[] }" }
 */
financeRouter.get("/summary", async (req, res) => {
  const filters = summaryQuerySchema.parse(req.query);
  res.json(await service.summary(filters, tenantId(req)));
});

/**
 * @openapi
 * /finance/transactions:
 *   get:
 *     tags: [Finance]
 *     summary: List ledger transactions (filter by type/category/date, paginated)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: type, schema: { type: string, enum: [income, expense] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated transactions }
 *   post:
 *     tags: [Finance]
 *     summary: Record a ledger transaction (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txnDate, type, category, amount]
 *             properties:
 *               txnDate: { type: string, format: date }
 *               type: { type: string, enum: [income, expense] }
 *               category: { type: string }
 *               amount: { type: number }
 *               description: { type: string }
 *               paymentMethod: { type: string }
 *               referenceNo: { type: string }
 *     responses:
 *       201: { description: Created transaction }
 */
financeRouter.get("/transactions", async (req, res) => {
  const params = listTransactionsQuerySchema.parse(req.query);
  res.json(
    await service.listTransactions(parsePagination(params), params, tenantId(req))
  );
});

financeRouter.post("/transactions", async (req, res) => {
  const input = createTransactionSchema.parse(req.body);
  res
    .status(201)
    .json(await service.createTransaction(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /finance/transactions/{id}:
 *   get:
 *     tags: [Finance]
 *     summary: Get one transaction
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Transaction }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Finance]
 *     summary: Update a transaction
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated transaction }
 *   delete:
 *     tags: [Finance]
 *     summary: Delete a transaction
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
financeRouter.get("/transactions/:id", async (req, res) => {
  res.json(await service.getTransaction(uuidParam(req), tenantId(req)));
});

financeRouter.patch("/transactions/:id", async (req, res) => {
  const input = updateTransactionSchema.parse(req.body);
  res.json(await service.updateTransaction(uuidParam(req), input, tenantId(req)));
});

financeRouter.delete("/transactions/:id", async (req, res) => {
  await service.deleteTransaction(uuidParam(req), tenantId(req));
  res.status(204).end();
});
