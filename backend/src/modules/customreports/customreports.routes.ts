import type { Request, Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { permissionsForRole, requirePermission } from "../../middleware/permissions";
import {
  adhocSchema,
  createCustomReportSchema,
  exportQuerySchema,
  updateCustomReportSchema,
} from "./customreports.schema";
import * as service from "./customreports.service";

export const customReportsRouter = Router();
customReportsRouter.use(authenticate, requireTenant);

const canRead = requirePermission("custom_reports:read");
const canCreate = requirePermission("custom_reports:create");
const canUpdate = requirePermission("custom_reports:update");
const canDelete = requirePermission("custom_reports:delete");
const canRun = requirePermission("custom_reports:run");
const canExport = requirePermission("custom_reports:export");

const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

async function hasPermission(req: Request, key: string): Promise<boolean> {
  if (req.user!.role === "super_admin") return true;
  return (await permissionsForRole(req.user!.role)).includes(key);
}

function sendExport(res: Response, key: string, out: { kind: "csv" | "pdf"; csv?: string; buffer?: Buffer }) {
  if (out.kind === "pdf") {
    res.type("application/pdf").set("Content-Disposition", `inline; filename="${key}.pdf"`).send(out.buffer);
  } else {
    res.type("text/csv").attachment(`${key}.csv`).send(out.csv);
  }
}

/**
 * @openapi
 * /custom-reports/sources:
 *   get: { tags: [Custom Reports], summary: Available report sources (Reports Center registry), security: [{ bearerAuth: [] }], responses: { 200: { description: "[{ key, title, category, permission }]" } } }
 */
customReportsRouter.get("/sources", canRead, (_req, res) => {
  res.json(service.sources());
});

/**
 * @openapi
 * /custom-reports:
 *   get: { tags: [Custom Reports], summary: List saved reports (shared + mine), security: [{ bearerAuth: [] }], responses: { 200: { description: Saved reports } } }
 *   post: { tags: [Custom Reports], summary: Create a saved report definition, security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
customReportsRouter.get("/", canRead, async (req, res) => {
  res.json(await service.listSaved(actor(req), tenantId(req)));
});
customReportsRouter.post("/", canCreate, async (req, res) => {
  const input = createCustomReportSchema.parse(req.body);
  const canShare = await hasPermission(req, "custom_reports:share");
  res.status(201).json(await service.createSaved(input, actor(req), tenantId(req), canShare));
});

/**
 * @openapi
 * /custom-reports/preview:
 *   post: { tags: [Custom Reports], summary: Run an ad-hoc report without saving (underlying permission enforced), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ title, columns, rows }" } } }
 */
customReportsRouter.post("/preview", canRun, async (req, res) => {
  const input = adhocSchema.parse(req.body);
  res.json(await service.adhocRun(input, actor(req), tenantId(req)));
});

/**
 * @openapi
 * /custom-reports/export:
 *   post: { tags: [Custom Reports], summary: Export an ad-hoc report (CSV/PDF), security: [{ bearerAuth: [] }], responses: { 200: { description: CSV or PDF } } }
 */
customReportsRouter.post("/export", canExport, async (req, res) => {
  const input = adhocSchema.parse(req.body);
  const { format } = exportQuerySchema.parse(req.query);
  const out = await service.adhocExport(input, format ?? "csv", actor(req), tenantId(req));
  sendExport(res, input.reportKey, out);
});

/**
 * @openapi
 * /custom-reports/{id}:
 *   get: { tags: [Custom Reports], summary: Get a saved report definition, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Definition }, 404: { description: Not found / not accessible } } }
 *   patch: { tags: [Custom Reports], summary: Edit a saved report (creator/admin), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Custom Reports], summary: Delete a saved report (creator/admin), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted } } }
 */
customReportsRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getSaved(uuidParam(req), actor(req), tenantId(req)));
});
customReportsRouter.patch("/:id", canUpdate, async (req, res) => {
  const input = updateCustomReportSchema.parse(req.body);
  const canShare = await hasPermission(req, "custom_reports:share");
  res.json(await service.updateSaved(uuidParam(req), input, actor(req), tenantId(req), canShare));
});
customReportsRouter.delete("/:id", canDelete, async (req, res) => {
  await service.deleteSaved(uuidParam(req), actor(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /custom-reports/{id}/duplicate:
 *   post: { tags: [Custom Reports], summary: Duplicate a saved report (private copy), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Copy } } }
 */
customReportsRouter.post("/:id/duplicate", canCreate, async (req, res) => {
  res.status(201).json(await service.duplicateSaved(uuidParam(req), actor(req), tenantId(req)));
});

/**
 * @openapi
 * /custom-reports/{id}/run:
 *   get: { tags: [Custom Reports], summary: Run a saved report (underlying permission enforced), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ title, columns, rows }" }, 403: { description: Lacks the source report's permission } } }
 */
customReportsRouter.get("/:id/run", canRun, async (req, res) => {
  res.json(await service.runSaved(uuidParam(req), actor(req), tenantId(req)));
});

/**
 * @openapi
 * /custom-reports/{id}/export:
 *   get: { tags: [Custom Reports], summary: Export a saved report (CSV/PDF), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: format, schema: { type: string, enum: [csv, pdf] } }], responses: { 200: { description: CSV or PDF } } }
 */
customReportsRouter.get("/:id/export", canExport, async (req, res) => {
  const { format } = exportQuerySchema.parse(req.query);
  const out = await service.exportSaved(uuidParam(req), format ?? "csv", actor(req), tenantId(req));
  sendExport(res, "custom-report", out);
});
