import type { Request } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { listJobsQuerySchema } from "./jobs.schema";
import * as service from "./jobs.service";
import { processDueJobs } from "./jobs.worker";

// The job console is for admins (their own institution's jobs) and super_admin
// (platform-wide). NOT requireTenant — super_admin (institution_id = null) must
// reach it — so scope is derived per request and enforced in the service.
export const jobsRouter = Router();
jobsRouter.use(authenticate);

const canRead = requirePermission("jobs:read");
const canManage = requirePermission("jobs:manage");
const canRetry = requirePermission("jobs:retry");
const canCancel = requirePermission("jobs:cancel");
const canRunScheduler = requirePermission("jobs:run_scheduler");

/** super_admin → all institutions (null); any other holder → their own tenant. */
function scope(req: Request): service.Scope {
  return req.user!.role === "super_admin" ? null : req.user!.institutionId;
}

/**
 * @openapi
 * /jobs:
 *   get: { tags: [Jobs], summary: List background jobs (tenant-scoped; super_admin sees all), security: [{ bearerAuth: [] }], parameters: [{ in: query, name: status, schema: { type: string } }, { in: query, name: type, schema: { type: string } }, { in: query, name: institutionId, schema: { type: string, format: uuid } }, { in: query, name: dateFrom, schema: { type: string } }, { in: query, name: dateTo, schema: { type: string } }], responses: { 200: { description: Jobs } } }
 */
jobsRouter.get("/", canRead, async (req, res) => {
  res.json(await service.listJobs(scope(req), listJobsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /jobs/run-scheduler:
 *   post: { tags: [Jobs], summary: Run the scheduler tick — enqueue due scheduled reports, security: [{ bearerAuth: [] }], responses: { 200: { description: "{ due, enqueued }" } } }
 */
jobsRouter.post("/run-scheduler", canRunScheduler, async (req, res) => {
  res.json(await service.runSchedulerTick(scope(req)));
});

/**
 * @openapi
 * /jobs/process:
 *   post: { tags: [Jobs], summary: Process due jobs now (drain the worker queue; scoped), security: [{ bearerAuth: [] }], responses: { 200: { description: "{ processed, success, failed, retried }" } } }
 */
jobsRouter.post("/process", canManage, async (req, res) => {
  res.json(await processDueJobs({ scope: scope(req), workerId: `manual-${req.user!.id}` }));
});

/**
 * @openapi
 * /jobs/{id}:
 *   get: { tags: [Jobs], summary: Job detail (scoped), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Job }, 404: { description: Not found } } }
 */
jobsRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getJob(uuidParam(req), scope(req)));
});

/**
 * @openapi
 * /jobs/{id}/retry:
 *   post: { tags: [Jobs], summary: Retry a failed job, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Re-queued } } }
 */
jobsRouter.post("/:id/retry", canRetry, async (req, res) => {
  res.json(await service.retryJob(uuidParam(req), scope(req)));
});

/**
 * @openapi
 * /jobs/{id}/cancel:
 *   post: { tags: [Jobs], summary: Cancel a pending job, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Cancelled } } }
 */
jobsRouter.post("/:id/cancel", canCancel, async (req, res) => {
  res.json(await service.cancelJob(uuidParam(req), scope(req)));
});
