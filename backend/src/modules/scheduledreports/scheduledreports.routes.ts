import type { Request } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import {
  createScheduleSchema,
  listRunsQuerySchema,
  updateScheduleSchema,
} from "./scheduledreports.schema";
import * as service from "./scheduledreports.service";

export const scheduledReportsRouter = Router();
scheduledReportsRouter.use(authenticate, requireTenant);

const canRead = requirePermission("scheduled_reports:read");
const canCreate = requirePermission("scheduled_reports:create");
const canUpdate = requirePermission("scheduled_reports:update");
const canDelete = requirePermission("scheduled_reports:delete");
const canRun = requirePermission("scheduled_reports:run");
const canHistory = requirePermission("scheduled_reports:history");
const canManage = requirePermission("scheduled_reports:manage");

const actor = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

/**
 * @openapi
 * /scheduled-reports:
 *   get: { tags: [Scheduled Reports], summary: List scheduled reports, security: [{ bearerAuth: [] }], responses: { 200: { description: Schedules } } }
 *   post: { tags: [Scheduled Reports], summary: Create a scheduled report (validates the saved report + the creator's underlying permission), security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
scheduledReportsRouter.get("/", canRead, async (req, res) => {
  res.json(await service.listSchedules(tenantId(req)));
});
scheduledReportsRouter.post("/", canCreate, async (req, res) => {
  const input = createScheduleSchema.parse(req.body);
  res.status(201).json(await service.createSchedule(input, actor(req), tenantId(req)));
});

/**
 * @openapi
 * /scheduled-reports/run-due:
 *   post: { tags: [Scheduled Reports], summary: Process due schedules (scheduler tick; runs each as its creator), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ processed, skipped, due }" } } }
 */
scheduledReportsRouter.post("/run-due", canManage, async (req, res) => {
  res.json(await service.runDue(tenantId(req)));
});

/**
 * @openapi
 * /scheduled-reports/{id}:
 *   get: { tags: [Scheduled Reports], summary: Get a scheduled report, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Schedule }, 404: { description: Not found } } }
 *   patch: { tags: [Scheduled Reports], summary: Edit / enable / disable a scheduled report, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Scheduled Reports], summary: Delete a scheduled report, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted } } }
 */
scheduledReportsRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getSchedule(uuidParam(req), tenantId(req)));
});
scheduledReportsRouter.patch("/:id", canUpdate, async (req, res) => {
  const input = updateScheduleSchema.parse(req.body);
  res.json(await service.updateSchedule(uuidParam(req), input, actor(req), tenantId(req)));
});
scheduledReportsRouter.delete("/:id", canDelete, async (req, res) => {
  await service.deleteSchedule(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /scheduled-reports/{id}/run:
 *   post: { tags: [Scheduled Reports], summary: Run a scheduled report now (as the caller; records run history), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Run record } } }
 */
scheduledReportsRouter.post("/:id/run", canRun, async (req, res) => {
  res.json(await service.runNow(uuidParam(req), actor(req), tenantId(req)));
});

/**
 * @openapi
 * /scheduled-reports/{id}/runs:
 *   get: { tags: [Scheduled Reports], summary: Run history for a scheduled report, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: limit, schema: { type: integer } }], responses: { 200: { description: Run history } } }
 */
scheduledReportsRouter.get("/:id/runs", canHistory, async (req, res) => {
  const { limit } = listRunsQuerySchema.parse(req.query);
  res.json(await service.listRuns(uuidParam(req), tenantId(req), limit ?? 50));
});
