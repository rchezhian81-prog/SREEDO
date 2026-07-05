import type { Request } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { clientIp } from "../../utils/security-audit";
import {
  archiveSchema,
  cancelSchema,
  createExportSchema,
  decisionSchema,
  downloadQuerySchema,
  listExportsQuerySchema,
  portabilityPackSchema,
  retentionUpdateSchema,
  scheduleCreateSchema,
  scheduleListQuerySchema,
  scheduleUpdateSchema,
} from "./exports.schema";
import * as service from "./exports.service";

// The Data Export Center sits above any tenant: super-admin only.
// authorize("super_admin") is the hard boundary; requirePermission documents +
// enforces the granular export:* model on top of it (owners bypass; sub-roles
// are checked against their granted keys).
export const exportsRouter = Router();
exportsRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request): service.Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

// ---------------------------------------------------------------------------
// Dashboard (specific literal paths first — before the /:id catch-all).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports/summary:
 *   get: { tags: [Exports], summary: "Data Export Center dashboard cards (status/sensitive/pending-approval/storage/downloads/schedules/recent events; no secrets)", security: [{ bearerAuth: [] }], responses: { 200: { description: Summary } } }
 */
exportsRouter.get("/summary", requirePermission("export:read"), async (_req, res) => {
  res.json(await service.summary());
});

// ---------------------------------------------------------------------------
// Schedules (before /:id).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports/schedules:
 *   get: { tags: [Exports], summary: "List scheduled exports (paginated)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Exports], summary: "Create a recurring scheduled export", security: [{ bearerAuth: [] }], responses: { 201: { description: Created schedule } } }
 */
exportsRouter.get("/schedules", requirePermission("export:schedule"), async (req, res) => {
  res.json(await service.listSchedules(scheduleListQuerySchema.parse(req.query)));
});
exportsRouter.post("/schedules", requirePermission("export:schedule"), async (req, res) => {
  res.status(201).json(await service.createSchedule(scheduleCreateSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /exports/schedules/{id}:
 *   patch: { tags: [Exports], summary: "Update a scheduled export (cadence/format/filters/enabled)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated schedule } } }
 *   delete: { tags: [Exports], summary: "Delete a scheduled export (config, not history)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Deleted } } }
 */
exportsRouter.patch("/schedules/:id", requirePermission("export:schedule"), async (req, res) => {
  res.json(await service.updateSchedule(uuidParam(req), scheduleUpdateSchema.parse(req.body ?? {}), actor(req)));
});
exportsRouter.delete("/schedules/:id", requirePermission("export:schedule"), async (req, res) => {
  res.json(await service.deleteSchedule(uuidParam(req), actor(req)));
});

// ---------------------------------------------------------------------------
// Retention settings (before /:id).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports/retention:
 *   get: { tags: [Exports], summary: "Export retention defaults (standard + sensitive)", security: [{ bearerAuth: [] }], responses: { 200: { description: Retention settings } } }
 *   patch: { tags: [Exports], summary: "Update export retention defaults", security: [{ bearerAuth: [] }], responses: { 200: { description: Updated settings } } }
 */
exportsRouter.get("/retention", requirePermission("export:retention"), async (_req, res) => {
  res.json(await service.getRetention());
});
exportsRouter.patch("/retention", requirePermission("export:retention"), async (req, res) => {
  res.json(await service.updateRetention(retentionUpdateSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Portability pack (before /:id).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports/portability:
 *   post: { tags: [Exports], summary: "Generate a full tenant data-portability pack (masked ZIP of tenant CSVs + README + manifest with per-file checksums; reason required; audited high-risk)", security: [{ bearerAuth: [] }], responses: { 201: { description: Completed portability export }, 400: { description: Reason required } } }
 */
exportsRouter.post("/portability", requirePermission("export:portability"), async (req, res) => {
  const input = portabilityPackSchema.parse(req.body ?? {});
  res
    .status(201)
    .json(await service.generatePortabilityPack(input.institutionId, input.name, input.reason, actor(req)));
});

// ---------------------------------------------------------------------------
// List + create.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports:
 *   get: { tags: [Exports], summary: "List exports (metadata only; never exposes storage paths)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Exports], summary: "Create a data export. Sensitive scopes need a reason; high-risk scopes need a second super-admin's approval before generating.", security: [{ bearerAuth: [] }], responses: { 201: { description: Created export (completed, pending, or awaiting approval) }, 400: { description: Reason required / unsupported scope } } }
 */
exportsRouter.get("/", requirePermission("export:read"), async (req, res) => {
  res.json(await service.listExports(listExportsQuerySchema.parse(req.query)));
});
exportsRouter.post("/", requirePermission("export:create"), async (req, res) => {
  res.status(201).json(await service.createExport(createExportSchema.parse(req.body ?? {}), actor(req)));
});

// ---------------------------------------------------------------------------
// Per-export routes.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /exports/{id}:
 *   get: { tags: [Exports], summary: "Get one export's metadata (no storage_key)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Export }, 404: { description: Not found } } }
 */
exportsRouter.get("/:id", requirePermission("export:read"), async (req, res) => {
  res.json(await service.getExport(uuidParam(req)));
});

/**
 * @openapi
 * /exports/{id}/manifest:
 *   get: { tags: [Exports], summary: "Get an export's manifest (masked; documents columns/rowCount/checksum/excluded fields — never a storage path)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Manifest }, 404: { description: Not found } } }
 */
exportsRouter.get("/:id/manifest", requirePermission("export:read"), async (req, res) => {
  res.json(await service.getManifest(uuidParam(req)));
});

/**
 * @openapi
 * /exports/{id}/download:
 *   get: { tags: [Exports], summary: "Download an export artifact (reason required; audited high-risk; only completed + unexpired + un-archived)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: reason, required: true, schema: { type: string, minLength: 5 } }], responses: { 200: { description: The artifact bytes }, 400: { description: Reason required / no artifact / expired } } }
 */
exportsRouter.get("/:id/download", requirePermission("export:download"), async (req, res) => {
  const { reason } = downloadQuerySchema.parse(req.query);
  const { buffer, filename, contentType } = await service.downloadExport(uuidParam(req), reason, actor(req));
  res.type(contentType).set("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
});

/**
 * @openapi
 * /exports/{id}/cancel:
 *   post: { tags: [Exports], summary: "Cancel a pending/running export (or a pending approval request)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Cancelled } } }
 */
exportsRouter.post("/:id/cancel", requirePermission("export:cancel"), async (req, res) => {
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json(await service.cancelExport(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /exports/{id}/archive:
 *   post: { tags: [Exports], summary: "Archive an export artifact (soft; metadata row retained; reason required)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Archived } } }
 */
exportsRouter.post("/:id/archive", requirePermission("export:retention"), async (req, res) => {
  const { reason } = archiveSchema.parse(req.body ?? {});
  res.json(await service.archiveExport(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /exports/{id}/decide:
 *   post: { tags: [Exports], summary: "Approve or reject a high-risk export request (reason required; self-approval blocked; approve generates the artifact)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Decided export }, 403: { description: Self-approval blocked } } }
 */
exportsRouter.post("/:id/decide", requirePermission("export:approve"), async (req, res) => {
  res.json(await service.decideExport(uuidParam(req), decisionSchema.parse(req.body ?? {}), actor(req)));
});
