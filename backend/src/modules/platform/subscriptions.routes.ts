import type { Request } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { uuidParam } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import type { Response } from "express";
import * as subs from "./subscriptions.service";
import type { Actor } from "./platform.service";
import {
  calendarQuerySchema,
  cancelSchema,
  changePackageSchema,
  configUpdateSchema,
  exportQuerySchema,
  extendSchema,
  listQuerySchema,
  markExpiredSchema,
  noteCreateSchema,
  noteUpdateSchema,
  reactivateSchema,
  renewSchema,
  reportQuerySchema,
  suspendSchema,
} from "./subscriptions.schema";

/**
 * Super Admin D — subscription management. Mounted at /platform (AFTER
 * platformRouter, so its literal GET /subscriptions/config keeps precedence).
 * The whole surface is super-admin only + per-route platform permissions.
 */
export const subscriptionsRouter = Router();
subscriptionsRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request): Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

const READ = requirePermission("platform:read");
const MANAGE = requirePermission("platform:manage_subscriptions");
const AUDIT = requirePermission("platform:audit_read");

function sendSpreadsheet(
  res: Response, format: "csv" | "xlsx", filename: string,
  columns: { key: string; label: string }[], rows: Record<string, unknown>[]
): void {
  const headers = columns.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(toXlsx(headers, data));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(headers, data));
  }
}

// ---- Literal collection routes (MUST precede GET /subscriptions/:id) ----

/**
 * @openapi
 * /platform/subscriptions/summary:
 *   get: { tags: [Platform], summary: "Subscription dashboard summary (status counts + revenue)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: soonDays, schema: { type: integer } }], responses: { 200: { description: "{ counts, revenue }" } } }
 */
subscriptionsRouter.get("/subscriptions/summary", READ, async (req, res) => {
  const soonDays = Math.min(120, Math.max(1, Number(req.query.soonDays ?? 30)));
  res.json(await subs.summary(soonDays));
});

/**
 * @openapi
 * /platform/subscriptions/list:
 *   get: { tags: [Platform], summary: "Search/filter/sort/paginate subscriptions", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
subscriptionsRouter.get("/subscriptions/list", READ, async (req, res) => {
  res.json(await subs.listSubscriptions(listQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/subscriptions/export:
 *   get: { tags: [Platform], summary: "Export the filtered subscription list (CSV/XLSX)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: format, schema: { type: string, enum: [csv, xlsx] } }], responses: { 200: { description: CSV/XLSX file } } }
 */
subscriptionsRouter.get("/subscriptions/export", READ, async (req, res) => {
  const q = exportQuerySchema.parse(req.query);
  const { columns, rows } = await subs.exportSubscriptions(q);
  sendSpreadsheet(res, q.format, "subscriptions", columns, rows);
});

/**
 * @openapi
 * /platform/subscriptions/calendar:
 *   get: { tags: [Platform], summary: "Renewal calendar (renewal/expiry/trial-end/grace-end dates)", security: [{ bearerAuth: [] }], responses: { 200: { description: "Calendar rows, or CSV/XLSX when format set" } } }
 */
subscriptionsRouter.get("/subscriptions/calendar", READ, async (req, res) => {
  const q = calendarQuerySchema.parse(req.query);
  const rows = await subs.calendar(q);
  if (q.format === "json") return res.json(rows);
  const columns = [
    { key: "date", label: "Date" }, { key: "kind", label: "Event" },
    { key: "institutionName", label: "Institution" }, { key: "institutionCode", label: "Code" },
    { key: "packageName", label: "Package" }, { key: "status", label: "Status" },
  ];
  sendSpreadsheet(res, q.format, "renewal-calendar", columns, rows as Record<string, unknown>[]);
});

/**
 * @openapi
 * /platform/subscriptions/reports:
 *   get: { tags: [Platform], summary: "Subscription reports (active/trial/expiring/expired/suspended/cancelled/grace/package-wise/institution-type/renewal-due/overdue/mrr/arr/churn/trial-conversion/upgrade-downgrade)", security: [{ bearerAuth: [] }], parameters: [{ in: query, name: key, required: true, schema: { type: string } }, { in: query, name: format, schema: { type: string, enum: [json, csv, xlsx] } }], responses: { 200: { description: "{ columns, rows, totals } or a file" } } }
 */
subscriptionsRouter.get("/subscriptions/reports", READ, async (req, res) => {
  const q = reportQuerySchema.parse(req.query);
  const out = await subs.report(q);
  if (q.format === "json") return res.json(out);
  sendSpreadsheet(res, q.format, `subscription-report-${q.key}`, out.columns, out.rows);
});

/**
 * @openapi
 * /platform/subscriptions/lifecycle-preview:
 *   get: { tags: [Platform], summary: "Dry-run preview of the lifecycle sweep (no writes)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ config, actions, note }" } } }
 */
subscriptionsRouter.get("/subscriptions/lifecycle-preview", READ, async (_req, res) => {
  res.json(await subs.lifecyclePreview());
});

/**
 * @openapi
 * /platform/subscriptions/config:
 *   put: { tags: [Platform], summary: "Update the lifecycle configuration (audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: Updated config } } }
 */
subscriptionsRouter.put("/subscriptions/config", MANAGE, async (req, res) => {
  res.json(await subs.updateLifecycleConfig(configUpdateSchema.parse(req.body), actor(req)));
});

// ---- Notes maintenance (literal 'notes' segment) ----

/**
 * @openapi
 * /platform/subscriptions/notes/{noteId}:
 *   patch: { tags: [Platform], summary: "Edit a subscription note (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: noteId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 *   delete: { tags: [Platform], summary: "Soft-delete a subscription note (audited; history kept)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: noteId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 */
subscriptionsRouter.patch("/subscriptions/notes/:noteId", MANAGE, async (req, res) => {
  res.json(await subs.updateNote(uuidParam(req, "noteId"), noteUpdateSchema.parse(req.body), actor(req)));
});
subscriptionsRouter.delete("/subscriptions/notes/:noteId", MANAGE, async (req, res) => {
  res.json(await subs.deleteNote(uuidParam(req, "noteId"), actor(req)));
});

// ---- Per-subscription routes ----

/**
 * @openapi
 * /platform/subscriptions/{id}:
 *   get: { tags: [Platform], summary: "Subscription detail (overview + billing + package + timeline + notes)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription detail }, 404: { description: Not found } } }
 */
subscriptionsRouter.get("/subscriptions/:id", READ, async (req, res) => {
  res.json(await subs.detail(uuidParam(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/events:
 *   get: { tags: [Platform], summary: "Subscription event history", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Events } } }
 */
subscriptionsRouter.get("/subscriptions/:id/events", AUDIT, async (req, res) => {
  res.json(await subs.listEvents(uuidParam(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/reminders:
 *   get: { tags: [Platform], summary: "Manual renewal-reminder send history", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Reminder history } } }
 */
subscriptionsRouter.get("/subscriptions/:id/reminders", READ, async (req, res) => {
  res.json(await subs.listReminders(uuidParam(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/notes:
 *   get: { tags: [Platform], summary: "Subscription CRM notes", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 *   post: { tags: [Platform], summary: "Add a subscription note (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Notes } } }
 */
subscriptionsRouter.get("/subscriptions/:id/notes", READ, async (req, res) => {
  res.json(await subs.notesForSubscription(uuidParam(req)));
});
subscriptionsRouter.post("/subscriptions/:id/notes", MANAGE, async (req, res) => {
  res.json(await subs.addNote(uuidParam(req), noteCreateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/reminder:
 *   post: { tags: [Platform], summary: "Send a renewal reminder now (audited; skipped when SMTP unset)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ configured, recipients }" } } }
 */
subscriptionsRouter.post("/subscriptions/:id/reminder", MANAGE, async (req, res) => {
  res.json(await subs.sendReminder(uuidParam(req), actor(req)));
});

// ---- High-risk lifecycle actions (reason required in the schema) ----

/**
 * @openapi
 * /platform/subscriptions/{id}/extend:
 *   post: { tags: [Platform], summary: "Extend a subscription's end date (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/extend", MANAGE, async (req, res) => {
  res.json(await subs.extend(uuidParam(req), extendSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/renew:
 *   post: { tags: [Platform], summary: "Renew a subscription (advance term; optional package/invoice; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/renew", MANAGE, async (req, res) => {
  res.json(await subs.renew(uuidParam(req), renewSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/change-package:
 *   post: { tags: [Platform], summary: "Change a subscription's package (reason required; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/change-package", MANAGE, async (req, res) => {
  res.json(await subs.changePackage(uuidParam(req), changePackageSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/cancel:
 *   post: { tags: [Platform], summary: "Cancel a subscription (reason required; history kept; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/cancel", MANAGE, async (req, res) => {
  res.json(await subs.cancel(uuidParam(req), cancelSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/suspend:
 *   post: { tags: [Platform], summary: "Suspend a subscription (reason required; optional tenant suspension; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/suspend", MANAGE, async (req, res) => {
  res.json(await subs.suspend(uuidParam(req), suspendSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/reactivate:
 *   post: { tags: [Platform], summary: "Reactivate a subscription (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/reactivate", MANAGE, async (req, res) => {
  res.json(await subs.reactivate(uuidParam(req), reactivateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/subscriptions/{id}/mark-expired:
 *   post: { tags: [Platform], summary: "Mark a subscription expired (reason required; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Subscription } } }
 */
subscriptionsRouter.post("/subscriptions/:id/mark-expired", MANAGE, async (req, res) => {
  res.json(await subs.markExpired(uuidParam(req), markExpiredSchema.parse(req.body), actor(req)));
});
