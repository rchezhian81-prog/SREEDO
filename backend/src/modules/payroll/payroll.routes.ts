import type { Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { permissionsForRole, requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import {
  createComponentSchema,
  createStructureSchema,
  runPayrollSchema,
  updateComponentSchema,
} from "./payroll.schema";
import * as service from "./payroll.service";

export const payrollRouter = Router();
payrollRouter.use(authenticate, requireTenant);

const canRead = requirePermission("payroll:read");
const canCreate = requirePermission("payroll:create");
const canUpdate = requirePermission("payroll:update");
const canDelete = requirePermission("payroll:delete");
const canRun = requirePermission("payroll:run");
const canFinalize = requirePermission("payroll:finalize");
const canPayslip = requirePermission("payroll:payslip");

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res.type("application/pdf").set("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
}

/**
 * @openapi
 * /payroll/components:
 *   get:
 *     tags: [Payroll]
 *     summary: List salary components (earnings + deductions)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Components } }
 *   post:
 *     tags: [Payroll]
 *     summary: Create a salary component
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code, type]
 *             properties:
 *               name: { type: string, example: Basic }
 *               code: { type: string, example: BASIC }
 *               type: { type: string, enum: [earning, deduction] }
 *               calcType: { type: string, enum: [fixed, percent] }
 *               defaultValue: { type: number }
 *     responses: { 201: { description: Created }, 409: { description: Duplicate code } }
 */
payrollRouter.get("/components", canRead, async (req, res) => {
  res.json(await service.listComponents(tenantId(req)));
});
payrollRouter.post("/components", canCreate, async (req, res) => {
  res.status(201).json(await service.createComponent(createComponentSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /payroll/components/{id}:
 *   patch:
 *     tags: [Payroll]
 *     summary: Update a salary component
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Payroll]
 *     summary: Delete a salary component (blocked if used)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
payrollRouter.patch("/components/:id", canUpdate, async (req, res) => {
  res.json(await service.updateComponent(uuidParam(req), updateComponentSchema.parse(req.body), tenantId(req)));
});
payrollRouter.delete("/components/:id", canDelete, async (req, res) => {
  await service.deleteComponent(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /payroll/structures:
 *   get:
 *     tags: [Payroll]
 *     summary: List salary structures (filter by staff; newest first)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: teacherId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Structures } }
 *   post:
 *     tags: [Payroll]
 *     summary: Assign a salary structure to a staff member (supersedes the active one)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teacherId, components]
 *             properties:
 *               teacherId: { type: string, format: uuid }
 *               effectiveDate: { type: string, format: date }
 *               components:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [componentId, value]
 *                   properties:
 *                     componentId: { type: string, format: uuid }
 *                     calcType: { type: string, enum: [fixed, percent] }
 *                     value: { type: number }
 *     responses: { 201: { description: Created structure } }
 */
payrollRouter.get("/structures", canRead, async (req, res) => {
  res.json(await service.listStructures(tenantId(req), optStr(req.query.teacherId)));
});
payrollRouter.post("/structures", canCreate, async (req, res) => {
  res.status(201).json(await service.createStructure(createStructureSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /payroll/structures/{id}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get a salary structure with its component lines
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Structure + components }, 404: { description: Not found } }
 *   delete:
 *     tags: [Payroll]
 *     summary: Delete a salary structure
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
payrollRouter.get("/structures/:id", canRead, async (req, res) => {
  res.json(await service.getStructure(uuidParam(req), tenantId(req)));
});
payrollRouter.delete("/structures/:id", canDelete, async (req, res) => {
  await service.deleteStructure(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /payroll/runs:
 *   get:
 *     tags: [Payroll]
 *     summary: List payroll runs (with payslip counts + net totals)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Runs } }
 *   post:
 *     tags: [Payroll]
 *     summary: Run monthly payroll (idempotent per staff/month; recalc needs payroll:update)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [month]
 *             properties:
 *               month: { type: string, example: "2026-07" }
 *               recalc: { type: boolean, description: "recompute existing payslips" }
 *     responses:
 *       200: { description: "{ runId, month, generated, skipped }" }
 *       409: { description: Month already finalized }
 */
payrollRouter.get("/runs", canRead, async (req, res) => {
  res.json(await service.listRuns(tenantId(req)));
});
payrollRouter.post("/runs", canRun, async (req, res) => {
  const input = runPayrollSchema.parse(req.body);
  // Recomputing existing payslips additionally requires payroll:update.
  if (input.recalc && req.user!.role !== "super_admin") {
    const perms = await permissionsForRole(req.user!.role);
    if (!perms.includes("payroll:update")) throw ApiError.forbidden("Recalculation requires payroll:update");
  }
  res.json(await service.runPayroll(input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /payroll/runs/{id}/finalize:
 *   post:
 *     tags: [Payroll]
 *     summary: Finalize/lock a payroll run and its payslips
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Finalized }, 409: { description: Already finalized } }
 */
payrollRouter.post("/runs/:id/finalize", canFinalize, async (req, res) => {
  res.json(await service.finalizeRun(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /payroll/payslips:
 *   get:
 *     tags: [Payroll]
 *     summary: List payslips (filter by run/staff/month)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: runId, schema: { type: string, format: uuid } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *       - { in: query, name: month, schema: { type: string, example: "2026-07" } }
 *     responses: { 200: { description: Payslips } }
 */
payrollRouter.get("/payslips", canRead, async (req, res) => {
  res.json(
    await service.listPayslips(tenantId(req), {
      runId: optStr(req.query.runId),
      teacherId: optStr(req.query.teacherId),
      month: optStr(req.query.month),
    })
  );
});

/**
 * @openapi
 * /payroll/payslips/mine:
 *   get:
 *     tags: [Payroll]
 *     summary: The signed-in staff member's own payslips
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Own payslips } }
 */
payrollRouter.get("/payslips/mine", canPayslip, async (req, res) => {
  res.json(await service.myPayslips(req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /payroll/payslips/{id}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get a payslip with its earning/deduction lines
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Payslip + lines } }
 */
payrollRouter.get("/payslips/:id", canRead, async (req, res) => {
  res.json(await service.getPayslip(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /payroll/payslips/{id}/pdf:
 *   get:
 *     tags: [Payroll]
 *     summary: Download a payslip PDF (owner-scoped — staff get only their own)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: PDF, content: { application/pdf: {} } }
 *       403: { description: Not the staff member's own payslip }
 */
payrollRouter.get("/payslips/:id/pdf", canPayslip, async (req, res) => {
  const buf = await service.payslipBuffer(req, uuidParam(req), tenantId(req));
  sendPdf(res, buf, "payslip.pdf");
});
