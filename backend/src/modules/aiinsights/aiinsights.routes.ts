import { Router } from "express";
import { z } from "zod";
import { param, uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import * as service from "./aiinsights.service";

export const aiInsightsRouter = Router();
aiInsightsRouter.use(authenticate, requireTenant);

const canRead = requirePermission("ai:read");
const canSummarize = requirePermission("ai:summarize");
const canRisk = requirePermission("ai:risk_alerts");
const canSearch = requirePermission("ai:document_search");
const canSuggest = requirePermission("ai:workflow_suggestions");

/**
 * @openapi
 * /ai-insights/dashboard:
 *   get:
 *     tags: [AI Insights]
 *     summary: AI insights dashboard (headline KPIs + workflow suggestions)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ aiAvailable, headline, suggestions }" } }
 */
aiInsightsRouter.get("/dashboard", canRead, async (req, res) => {
  res.json(await service.insightsDashboard(tenantId(req)));
});

/**
 * @openapi
 * /ai-insights/summary/{report}:
 *   get:
 *     tags: [AI Insights]
 *     summary: AI/KPI summary for a report (metrics always; narrative when OpenAI configured)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: report, required: true, schema: { type: string, enum: [attendance, fees, exams, homework, payroll, library, transport, hostel, inventory] } }
 *     responses:
 *       200: { description: "{ report, metrics, narrative, aiAvailable }" }
 *       400: { description: Unknown report }
 */
aiInsightsRouter.get("/summary/:report", canSummarize, async (req, res) => {
  res.json(await service.summarize(param(req, "report"), tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /ai-insights/risk/attendance:
 *   get:
 *     tags: [AI Insights]
 *     summary: Attendance risk — students below a threshold over a window
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: threshold, schema: { type: integer, example: 75 } }
 *       - { in: query, name: windowDays, schema: { type: integer, example: 60 } }
 *     responses: { 200: { description: "{ threshold, windowDays, count, students, narrative }" } }
 */
aiInsightsRouter.get("/risk/attendance", canRisk, async (req, res) => {
  const q = z
    .object({
      threshold: z.coerce.number().min(1).max(100).optional(),
      windowDays: z.coerce.number().int().min(1).max(365).optional(),
    })
    .parse(req.query);
  res.json(await service.attendanceRisk(tenantId(req), q, req.user!.id));
});

/**
 * @openapi
 * /ai-insights/risk/fees:
 *   get:
 *     tags: [AI Insights]
 *     summary: Fee pending/collection risk (overdue + high dues; manual reminder only)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ pendingCount, overdueCount, totalOutstanding, invoices, suggestedAction }" } }
 */
aiInsightsRouter.get("/risk/fees", canRisk, async (req, res) => {
  res.json(await service.feeRisk(tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /ai-insights/search:
 *   get:
 *     tags: [AI Insights]
 *     summary: Semantic document search (falls back to keyword when embeddings unconfigured)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string } }
 *     responses: { 200: { description: "{ mode: semantic|keyword, results }" } }
 */
aiInsightsRouter.get("/search", canSearch, async (req, res) => {
  const { q } = z.object({ q: z.string().min(1).max(200) }).parse(req.query);
  res.json(await service.documentSearch(q, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /ai-insights/suggestions:
 *   get:
 *     tags: [AI Insights]
 *     summary: Deterministic workflow suggestions from tenant data
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ suggestions: [{ key, label, count, href }] }" } }
 */
aiInsightsRouter.get("/suggestions", canSuggest, async (req, res) => {
  res.json(await service.workflowSuggestions(tenantId(req)));
});

/**
 * @openapi
 * /ai-insights/students/{id}/performance:
 *   get:
 *     tags: [AI Insights]
 *     summary: Per-student performance analysis (attendance/exams/homework/fees/discipline) with risk flags + intervention hints
 *     description: Flags and hints are computed deterministically; an OpenAI narrative is added when configured.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: windowDays, schema: { type: integer, example: 90 } }
 *     responses:
 *       200: { description: "{ student, windowDays, attendance, exams, homework, fees, discipline, flags, narrative, aiAvailable }" }
 *       404: { description: Student not found }
 */
aiInsightsRouter.get("/students/:id/performance", canSummarize, async (req, res) => {
  const q = z
    .object({ windowDays: z.coerce.number().int().min(1).max(365).optional() })
    .parse(req.query);
  res.json(
    await service.studentPerformance(uuidParam(req), tenantId(req), req.user!.id, q)
  );
});
