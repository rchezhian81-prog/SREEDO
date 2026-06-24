import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { ApiError } from "../../utils/api-error";
import { activityQuerySchema } from "./activity.schema";
import { listAuditLogs, auditLogsCsv } from "../adminconsole/adminconsole.service";

/**
 * Institution-admin activity log: a read-only view of the audit trail, always
 * scoped to the caller's OWN institution. Super-admins have the global viewer in
 * the admin console; this gives an institution admin visibility into their own
 * tenant without ever exposing other tenants' activity.
 */
export const activityRouter = Router();
activityRouter.use(authenticate, authorize("admin"));

/**
 * @openapi
 * /activity:
 *   get:
 *     tags: [Activity]
 *     summary: Institution activity log (audit trail scoped to your institution)
 *     description: >-
 *       Read-only audit trail of mutating actions in the caller's institution.
 *       Reads MongoDB and degrades gracefully ({ available:false }) when it is
 *       not configured.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: userId, schema: { type: string, format: uuid } }
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string, example: POST } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200: { description: "{ available: boolean, rows: AuditRow[] }" }
 *       403: { description: Caller has no institution context }
 */
activityRouter.get("/", async (req, res) => {
  const institutionId = req.user!.institutionId;
  if (!institutionId) {
    throw ApiError.forbidden("No institution context for the activity log");
  }
  const filters = activityQuerySchema.parse(req.query);
  res.json(
    await listAuditLogs({
      institutionId,
      userId: filters.userId,
      module: filters.module,
      action: filters.action,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: filters.limit ?? 100,
    })
  );
});

/**
 * @openapi
 * /activity/export:
 *   get:
 *     tags: [Activity]
 *     summary: Export your institution's activity log as CSV
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: action, schema: { type: string, example: POST } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: CSV file, content: { text/csv: {} } }
 *       403: { description: Caller has no institution context }
 */
activityRouter.get("/export", async (req, res) => {
  const institutionId = req.user!.institutionId;
  if (!institutionId) {
    throw ApiError.forbidden("No institution context for the activity log");
  }
  const filters = activityQuerySchema.parse(req.query);
  const csv = await auditLogsCsv({
    institutionId,
    userId: filters.userId,
    module: filters.module,
    action: filters.action,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    limit: filters.limit ?? 500,
  });
  res.type("text/csv").attachment("activity-log.csv").send(csv);
});
