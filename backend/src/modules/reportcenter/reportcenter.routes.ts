import type { Request } from "express";
import { Router } from "express";
import { param } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { permissionsForRole, requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import {
  getReport,
  listReports,
  toCsv,
  type Filters,
} from "./reportcenter.service";
import { tablePdf } from "./reportcenter.pdf";

export const reportCenterRouter = Router();

reportCenterRouter.use(authenticate, requireTenant);

/** Per-report permission check (the required key depends on the report). */
async function assertPerm(req: Request, key: string): Promise<void> {
  if (req.user!.role === "super_admin") return;
  const perms = await permissionsForRole(req.user!.role);
  if (!perms.includes(key)) throw ApiError.forbidden();
}

function parseFilters(q: Request["query"]): Filters {
  const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    classId: s(q.classId),
    sectionId: s(q.sectionId),
    studentId: s(q.studentId),
    staffId: s(q.staffId),
    status: s(q.status),
    dateFrom: s(q.dateFrom),
    dateTo: s(q.dateTo),
    examId: s(q.examId),
    subjectId: s(q.subjectId),
    category: s(q.category),
    ownerType: s(q.ownerType),
    search: s(q.search),
    programId: s(q.programId),
    semesterId: s(q.semesterId),
    departmentId: s(q.departmentId),
  };
}

/**
 * @openapi
 * /report-center:
 *   get:
 *     tags: [Reports Center]
 *     summary: List available reports
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Report metadata (key, title, category, permission)" }
 */
reportCenterRouter.get("/", requirePermission("reports:center:read"), (_req, res) => {
  res.json(listReports());
});

/**
 * @openapi
 * /report-center/{key}:
 *   get:
 *     tags: [Reports Center]
 *     summary: Run a report and return its rows (filtered, tenant-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string } }
 *       - { in: query, name: sectionId, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string } }
 *       - { in: query, name: dateTo, schema: { type: string } }
 *       - { in: query, name: examId, schema: { type: string } }
 *     responses:
 *       200: { description: "{ title, columns, rows }" }
 *       403: { description: Missing the report's permission }
 *       404: { description: Unknown report }
 */
reportCenterRouter.get("/:key", async (req, res) => {
  const report = getReport(param(req, "key"));
  await assertPerm(req, report.permission);
  res.json(await report.run(parseFilters(req.query), tenantId(req)));
});

/**
 * @openapi
 * /report-center/{key}/export:
 *   get:
 *     tags: [Reports Center]
 *     summary: Export a report as CSV (default) or PDF
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [csv, pdf] } }
 *     responses:
 *       200: { description: CSV or PDF file }
 */
reportCenterRouter.get("/:key/export", async (req, res) => {
  const report = getReport(param(req, "key"));
  await assertPerm(req, report.permission);
  await assertPerm(req, "reports:center:export");
  const result = await report.run(parseFilters(req.query), tenantId(req));
  const key = param(req, "key");
  if (req.query.format === "pdf") {
    const pdf = await tablePdf(result.title, result.columns, result.rows);
    res
      .type("application/pdf")
      .set("Content-Disposition", `inline; filename="${key}.pdf"`)
      .send(pdf);
  } else {
    res.type("text/csv").attachment(`${key}.csv`).send(toCsv(result.columns, result.rows));
  }
});
