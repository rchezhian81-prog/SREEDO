import type { Request } from "express";
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { overviewExportQuerySchema, overviewQuerySchema } from "./overview.schema";
import * as service from "./overview.service";

/**
 * Super Admin E — Platform Overview Dashboard (read-only executive aggregator).
 *
 * `authenticate` + a per-route `requirePermission`. `overview:read` is granted
 * only to super_admin + auditor + technical_admin (never a tenant role), so
 * `requirePermission("overview:read")` alone makes the whole surface
 * platform-only — a tenant admin lacks the perm and gets 403, no extra role
 * guard needed. The SECTION-level hiding still happens INSIDE the service so a
 * technical_admin / auditor only sees the sections their OTHER perms allow.
 */
export const overviewRouter = Router();
overviewRouter.use(authenticate);

const canRead = requirePermission("overview:read");
const canExport = requirePermission("overview:export");

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /overview/summary:
 *   get:
 *     tags: [Overview]
 *     summary: "Executive platform overview — aggregated health/tenant/subscription/billing/security/operations KPIs + cross-module status cards + maintenance, RBAC-hidden per section (no fabricated data)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, this_month, last_month, custom], default: 30d } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "Overview payload (sections the caller lacks perms for are available:false)" }
 *       403: { description: "Missing overview:read (tenant roles)" }
 */
overviewRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.summary(req.user!, overviewQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /overview/attention:
 *   get:
 *     tags: [Overview]
 *     summary: "Prioritized 'needs attention' list (critical first) drawn from the reused module summaries. Read-only — acknowledgement lives in the source module. RBAC-filtered."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ generatedAt, items: [{ severity, summary, sourceModule, createdAt, actionLink }] }" }
 *       403: { description: "Missing overview:read" }
 */
overviewRouter.get("/attention", canRead, async (req, res) => {
  res.json(await service.attention(req.user!));
});

/**
 * @openapi
 * /overview/trends:
 *   get:
 *     tags: [Overview]
 *     summary: "Lightweight group-by-day trends computed from REAL stored timestamps only. A metric with no history returns an empty series + 'trend begins from collected data' — never fabricated. RBAC-filtered."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, this_month, last_month, custom], default: 30d } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ generatedAt, range, trends }" }
 *       403: { description: "Missing overview:read" }
 */
overviewRouter.get("/trends", canRead, async (req, res) => {
  res.json(await service.trends(req.user!, overviewQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /overview/quick-actions:
 *   get:
 *     tags: [Overview]
 *     summary: "Quick-action tiles with a per-action `allowed` flag from the caller's RBAC (backend is the source of truth; the frontend hides/disables the disallowed ones)."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ actions: [{ key, label, route, allowed }] }" }
 *       403: { description: "Missing overview:read" }
 */
overviewRouter.get("/quick-actions", canRead, async (req, res) => {
  res.json(await service.quickActions(req.user!));
});

/**
 * @openapi
 * /overview/modules:
 *   get:
 *     tags: [Overview]
 *     summary: "Cross-module status cards (status healthy/warning/critical/unknown + key metric + last activity + attention count), RBAC-hidden per module."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, this_month, last_month, custom], default: 30d } }
 *     responses:
 *       200: { description: "{ generatedAt, range, moduleStatus }" }
 *       403: { description: "Missing overview:read" }
 */
overviewRouter.get("/modules", canRead, async (req, res) => {
  res.json(await service.moduleStatus(req.user!, overviewQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /overview/export:
 *   get:
 *     tags: [Overview]
 *     summary: "Export a MASKED platform-overview snapshot (CSV or JSON) of the KPI values + attention list. Audited (overview.exported); never emits secrets/paths/tokens."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: format, schema: { type: string, enum: [csv, json], default: csv } }
 *       - { in: query, name: window, schema: { type: string, enum: [today, 7d, 30d, this_month, last_month, custom], default: 30d } }
 *       - { in: query, name: reason, schema: { type: string } }
 *     responses:
 *       200: { description: "A masked CSV or JSON snapshot download" }
 *       403: { description: "Missing overview:export" }
 */
overviewRouter.get("/export", canExport, async (req, res) => {
  const q = overviewExportQuerySchema.parse(req.query);
  const { buffer, filename, contentType } = await service.exportSnapshot(
    req.user!,
    { format: q.format, window: { window: q.window, dateFrom: q.dateFrom, dateTo: q.dateTo }, reason: q.reason },
    actor(req)
  );
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});
