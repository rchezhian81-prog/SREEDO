import { Router, type Request } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission, effectivePermissions } from "../../middleware/permissions";
import { requireStaff } from "../../utils/scope";
import { param, uuidParam } from "../../utils/params";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { toCsv } from "../../utils/spreadsheet";
import * as svc from "./dataio.service";
import { importBodySchema, exportQuerySchema } from "./dataio.schema";
import { IMPORT_BY_KEY } from "./dataio.import";

// PR-T5 — Tenant Import/Export Center. Staff-only, tenant-scoped. data_io:*
// gates the surface; each entity additionally composes its own per-entity
// permission (so the center is never a permission bypass). Imports are strictly
// dry-run → commit (all-or-nothing); sensitive exports are reason-gated + audited.
export const dataioRouter = Router();
dataioRouter.use(authenticate, requireTenant);

async function buildContext(req: Request): Promise<svc.IoContext> {
  requireStaff(req);
  const institutionId = tenantId(req);
  const { rows } = await query<{ type: "school" | "college" }>(
    `SELECT type FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const perms = new Set(await effectivePermissions(req.user!));
  return {
    institutionId,
    type: rows[0]?.type === "college" ? "college" : "school",
    perms,
    actor: { id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip ?? null },
  };
}

const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * @openapi
 * /dataio/entities:
 *   get:
 *     tags: [DataIO]
 *     summary: The import/export catalogue available to the caller (mode + permission filtered)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ imports: [], exports: [] }" } }
 */
dataioRouter.get("/entities", requirePermission("data_io:read"), async (req, res) => {
  const ctx = await buildContext(req);
  res.json(svc.catalogFor(ctx));
});

/**
 * @openapi
 * /dataio/import/{entity}/template:
 *   get:
 *     tags: [DataIO]
 *     summary: Download a CSV template (header row) for an import entity
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: entity, required: true, schema: { type: string } }
 *     responses: { 200: { description: CSV template } }
 */
dataioRouter.get("/import/:entity/template", requirePermission("data_io:read"), async (req, res) => {
  requireStaff(req);
  const entity = IMPORT_BY_KEY[param(req, "entity")];
  if (!entity) throw ApiError.badRequest("Unknown import entity");
  const csv = toCsv(entity.columns.map((c) => c.field), []);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${entity.key}_template.csv"`);
  res.send(csv);
});

/**
 * @openapi
 * /dataio/import/{entity}/dry-run:
 *   post:
 *     tags: [DataIO]
 *     summary: Validate a CSV without writing (per-row errors + a persisted dry-run batch)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ batchId, total, valid, invalid, rows }" } }
 */
dataioRouter.post("/import/:entity/dry-run", requirePermission("data_io:import"), async (req, res) => {
  const ctx = await buildContext(req);
  const { csv, filename } = importBodySchema.parse(req.body);
  res.json(await svc.dryRunImport(param(req, "entity"), csv, filename ?? null, ctx));
});

/**
 * @openapi
 * /dataio/import/{entity}/commit:
 *   post:
 *     tags: [DataIO]
 *     summary: Commit an import atomically (rejected with per-row errors unless every row is valid)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ batchId, imported }" }
 *       400: { description: Validation failed — no rows committed }
 */
dataioRouter.post("/import/:entity/commit", requirePermission("data_io:import"), async (req, res) => {
  const ctx = await buildContext(req);
  const { csv, filename } = importBodySchema.parse(req.body);
  res.json(await svc.commitImport(param(req, "entity"), csv, filename ?? null, ctx));
});

/**
 * @openapi
 * /dataio/imports:
 *   get:
 *     tags: [DataIO]
 *     summary: Recent import batches (history / troubleshooting)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Import batch list } }
 */
dataioRouter.get("/imports", requirePermission("data_io:read"), async (req, res) => {
  requireStaff(req);
  res.json(await svc.listBatches(tenantId(req)));
});

/**
 * @openapi
 * /dataio/imports/{id}/rows:
 *   get:
 *     tags: [DataIO]
 *     summary: Per-row results (errors) for one import batch
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Row-level results } }
 */
dataioRouter.get("/imports/:id/rows", requirePermission("data_io:read"), async (req, res) => {
  requireStaff(req);
  res.json(await svc.batchRows(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /dataio/imports/{id}/cancel:
 *   post:
 *     tags: [DataIO]
 *     summary: Cancel (abandon) a dry-run batch
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ batchId, status }" } }
 */
dataioRouter.post("/imports/:id/cancel", requirePermission("data_io:import"), async (req, res) => {
  const ctx = await buildContext(req);
  res.json(await svc.cancelBatch(uuidParam(req), ctx));
});

/**
 * @openapi
 * /dataio/export/{entity}:
 *   get:
 *     tags: [DataIO]
 *     summary: Export a tenant dataset as CSV/XLSX (sensitive datasets need ?reason=, audited)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: entity, required: true, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }
 *       - { in: query, name: reason, schema: { type: string } }
 *     responses:
 *       200: { description: The exported file }
 *       400: { description: A reason is required for a sensitive dataset }
 */
dataioRouter.get("/export/:entity", requirePermission("data_io:export"), async (req, res) => {
  const ctx = await buildContext(req);
  const { format, reason } = exportQuerySchema.parse(req.query);
  const out = await svc.exportData(param(req, "entity"), format, reason, isoToday(), ctx);
  res.setHeader("Content-Type", out.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.send(out.body);
});
