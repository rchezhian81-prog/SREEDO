import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import * as service from "./observability.service";

// Protected platform observability (super-admin only via observability:* grants).
// Public liveness/readiness probes live at the app root (/health, /ready).
export const observabilityRouter = Router();
observabilityRouter.use(authenticate);

/**
 * @openapi
 * /observability/metrics:
 *   get: { tags: [Observability], summary: Prometheus metrics (requests, errors, durations, job + scheduled-report counters), security: [{ bearerAuth: [] }], responses: { 200: { description: text/plain exposition } } }
 */
observabilityRouter.get("/metrics", requirePermission("observability:metrics"), async (_req, res) => {
  res.type("text/plain; version=0.0.4").send(await service.renderMetrics());
});

/**
 * @openapi
 * /observability/health:
 *   get: { tags: [Observability], summary: Detailed platform health (DB/Mongo, migrations, queue depth, config), security: [{ bearerAuth: [] }], responses: { 200: { description: Health } } }
 */
observabilityRouter.get("/health", requirePermission("observability:health"), async (_req, res) => {
  res.json(await service.detailedHealth());
});

/**
 * @openapi
 * /observability/overview:
 *   get: { tags: [Observability], summary: Observability overview (request/error/job/queue/scheduled-report summary + recent failures), security: [{ bearerAuth: [] }], responses: { 200: { description: Overview } } }
 */
observabilityRouter.get("/overview", requirePermission("observability:read"), async (_req, res) => {
  res.json(await service.overview());
});
