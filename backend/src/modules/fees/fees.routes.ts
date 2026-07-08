import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import {
  accessibleStudentIds,
  assertStudentAccess,
  requireStaff,
} from "../../utils/scope";
import {
  createFeeStructureSchema,
  createInvoiceSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
} from "./fees.schema";
import {
  applyDiscountSchema,
  applyFineSchema,
  createCategorySchema,
  createDiscountSchema,
  createFineRuleSchema,
  createScheduleSchema,
  updateCategorySchema,
  updateScheduleSchema,
  waiveSchema,
} from "./feedepth.schema";
import * as feesService from "./fees.service";
import * as depth from "./feedepth.service";

export const feesRouter = Router();

feesRouter.use(authenticate, requireTenant);

// Core fee money-writes (T2.1): invoices/structures need fees:manage, payments
// need fees:payment. Seeded to admin+accountant, so behaviour is unchanged.
const manageFees = requirePermission("fees:manage");
const takePayment = requirePermission("fees:payment");

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
feesRouter.get("/structures", async (req, res) => {
  res.json(await feesService.listFeeStructures(tenantId(req)));
});

feesRouter.post("/structures", manageFees, async (req, res) => {
  const input = createFeeStructureSchema.parse(req.body);
  res.status(201).json(await feesService.createFeeStructure(input, tenantId(req)));
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
  const result = await feesService.listInvoices(
    parsePagination(queryParams),
    { studentId: queryParams.studentId, status: queryParams.status },
    tenantId(req),
    await accessibleStudentIds(req)
  );
  res.json(result);
});

feesRouter.post("/invoices", manageFees, async (req, res) => {
  const input = createInvoiceSchema.parse(req.body);
  res.status(201).json(await feesService.createInvoice(input, tenantId(req)));
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
  const invoice = await feesService.getInvoice(uuidParam(req), tenantId(req));
  assertStudentAccess(await accessibleStudentIds(req), invoice.studentId);
  res.json(invoice);
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
feesRouter.post("/invoices/:id/payments", takePayment, async (req, res) => {
  const input = recordPaymentSchema.parse(req.body);
  res.json(
    await feesService.recordPayment(uuidParam(req), input, req.user!.id, tenantId(req))
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
feesRouter.get("/summary", async (req, res) => {
  requireStaff(req); // school-wide totals are staff-only
  res.json(await feesService.feeSummary(tenantId(req)));
});

// --- Fee Management Depth: categories, schedules, fines, discounts, breakdown ---
// All endpoints are tenant-scoped (requireTenant above) and permission-guarded.

/**
 * @openapi
 * /fees/categories:
 *   get: { tags: [Fees], summary: List fee categories, security: [{ bearerAuth: [] }], responses: { 200: { description: Categories } } }
 *   post: { tags: [Fees], summary: Create a fee category, security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
feesRouter.get("/categories", requirePermission("fee_categories:read"), async (req, res) => {
  res.json(await depth.listCategories(tenantId(req)));
});
feesRouter.post("/categories", requirePermission("fee_categories:create"), async (req, res) => {
  res.status(201).json(await depth.createCategory(createCategorySchema.parse(req.body), tenantId(req)));
});
/**
 * @openapi
 * /fees/categories/{id}:
 *   patch: { tags: [Fees], summary: Update a fee category, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Fees], summary: Delete a fee category, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted } } }
 */
feesRouter.patch("/categories/:id", requirePermission("fee_categories:update"), async (req, res) => {
  res.json(await depth.updateCategory(uuidParam(req), updateCategorySchema.parse(req.body), tenantId(req)));
});
feesRouter.delete("/categories/:id", requirePermission("fee_categories:delete"), async (req, res) => {
  await depth.deleteCategory(uuidParam(req), tenantId(req));
  res.status(204).send();
});

/**
 * @openapi
 * /fees/schedules:
 *   get: { tags: [Fees], summary: List fee schedules, security: [{ bearerAuth: [] }], responses: { 200: { description: Schedules } } }
 *   post: { tags: [Fees], summary: Create a term-wise fee schedule, security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
feesRouter.get("/schedules", requirePermission("fee_schedules:read"), async (req, res) => {
  res.json(await depth.listSchedules(tenantId(req)));
});
feesRouter.post("/schedules", requirePermission("fee_schedules:create"), async (req, res) => {
  res.status(201).json(
    await depth.createSchedule(createScheduleSchema.parse(req.body), tenantId(req), req.user!.id)
  );
});
/**
 * @openapi
 * /fees/schedules/{id}:
 *   patch: { tags: [Fees], summary: Update a fee schedule, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
feesRouter.patch("/schedules/:id", requirePermission("fee_schedules:update"), async (req, res) => {
  res.json(await depth.updateSchedule(uuidParam(req), updateScheduleSchema.parse(req.body), tenantId(req)));
});
/**
 * @openapi
 * /fees/schedules/{id}/preview:
 *   get: { tags: [Fees], summary: Preview the students a schedule would invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ targetCount, toGenerate, students }" } } }
 */
feesRouter.get("/schedules/:id/preview", requirePermission("fee_schedules:generate"), async (req, res) => {
  res.json(await depth.previewSchedule(uuidParam(req), tenantId(req)));
});
/**
 * @openapi
 * /fees/schedules/{id}/generate:
 *   post: { tags: [Fees], summary: Generate invoices from a schedule (idempotent), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ created }" } } }
 */
feesRouter.post("/schedules/:id/generate", requirePermission("fee_schedules:generate"), async (req, res) => {
  res.json(await depth.generateInvoices(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /fees/fine-rules:
 *   get: { tags: [Fees], summary: List late-fine rules, security: [{ bearerAuth: [] }], responses: { 200: { description: Rules } } }
 *   post: { tags: [Fees], summary: Create a late-fine rule, security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
feesRouter.get("/fine-rules", requirePermission("fee_fines:read"), async (req, res) => {
  res.json(await depth.listFineRules(tenantId(req)));
});
feesRouter.post("/fine-rules", requirePermission("fee_fines:apply"), async (req, res) => {
  res.status(201).json(await depth.createFineRule(createFineRuleSchema.parse(req.body), tenantId(req)));
});
/**
 * @openapi
 * /fees/invoices/{id}/fines:
 *   post: { tags: [Fees], summary: Apply a late fine to an invoice, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Applied fine + new amount } } }
 */
feesRouter.post("/invoices/:id/fines", requirePermission("fee_fines:apply"), async (req, res) => {
  res.json(await depth.applyFine(uuidParam(req), applyFineSchema.parse(req.body ?? {}), req.user!.id, tenantId(req)));
});
/**
 * @openapi
 * /fees/fines/apply-overdue:
 *   post: { tags: [Fees], summary: Apply active fine rules to all overdue invoices, security: [{ bearerAuth: [] }], responses: { 200: { description: "{ applied }" } } }
 */
feesRouter.post("/fines/apply-overdue", requirePermission("fee_fines:apply"), async (req, res) => {
  res.json(await depth.applyOverdueFines(tenantId(req), req.user!.id));
});
/**
 * @openapi
 * /fees/applied-fines/{id}/waive:
 *   post: { tags: [Fees], summary: Waive an applied fine (permission-gated), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Waived + new amount } } }
 */
feesRouter.post("/applied-fines/:id/waive", requirePermission("fee_fines:waive"), async (req, res) => {
  waiveSchema.parse(req.body ?? {});
  res.json(await depth.waiveFine(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /fees/discounts:
 *   get: { tags: [Fees], summary: List discounts/scholarships, security: [{ bearerAuth: [] }], responses: { 200: { description: Discounts } } }
 *   post: { tags: [Fees], summary: Create a discount/scholarship, security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
feesRouter.get("/discounts", requirePermission("fee_discounts:read"), async (req, res) => {
  res.json(await depth.listDiscounts(tenantId(req)));
});
feesRouter.post("/discounts", requirePermission("fee_discounts:apply"), async (req, res) => {
  res.status(201).json(await depth.createDiscount(createDiscountSchema.parse(req.body), tenantId(req)));
});
/**
 * @openapi
 * /fees/invoices/{id}/discounts:
 *   post: { tags: [Fees], summary: Apply a discount to an invoice (pending approval), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Applied (pending) } } }
 */
feesRouter.post("/invoices/:id/discounts", requirePermission("fee_discounts:apply"), async (req, res) => {
  res.json(await depth.applyDiscount(uuidParam(req), applyDiscountSchema.parse(req.body), req.user!.id, tenantId(req)));
});
/**
 * @openapi
 * /fees/applied-discounts/{id}/approve:
 *   post: { tags: [Fees], summary: Approve an applied discount (reduces the invoice), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Approved + new amount } } }
 */
feesRouter.post("/applied-discounts/:id/approve", requirePermission("fee_discounts:approve"), async (req, res) => {
  res.json(await depth.approveDiscount(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /fees/invoices/{id}/breakdown:
 *   get:
 *     tags: [Fees]
 *     summary: Invoice breakdown (base, fines, discounts, outstanding) — owner-scoped
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ invoice, base, fineTotal, discountTotal, outstanding, fines, discounts }" }
 *       403: { description: Not an accessible student }
 */
feesRouter.get("/invoices/:id/breakdown", async (req, res) => {
  const result = await depth.invoiceBreakdown(uuidParam(req), tenantId(req));
  assertStudentAccess(await accessibleStudentIds(req), result.studentId);
  res.json(result);
});
