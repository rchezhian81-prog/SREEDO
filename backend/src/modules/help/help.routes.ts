import type { Request } from "express";
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { param } from "../../utils/params";
import * as schema from "./help.schema";
import * as service from "./help.service";

/**
 * Super Admin Q — Help / SOP / Documentation / Module Status Center.
 *
 * `authenticate` + a per-route `requirePermission`. `help:read` is granted to
 * super_admin + every platform sub-role (never a tenant role), so
 * `requirePermission("help:read")` alone makes the whole surface platform-only —
 * a tenant admin lacks the perm and gets 403. `help:export` is super_admin-only.
 * All content is READ-ONLY curated docs; the only write is the export audit row.
 */
export const helpRouter = Router();
helpRouter.use(authenticate);

const canRead = requirePermission("help:read");
const canExport = requirePermission("help:export");

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /help/summary:
 *   get:
 *     tags: [Help]
 *     summary: "Help/SOP center dashboard — completion status, doc counts, recently-updated, docs-needing-review, critical runbooks, onboarding status, last-update (all from curated content)."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Help dashboard summary" }
 *       403: { description: "Missing help:read (tenant roles)" }
 */
helpRouter.get("/summary", canRead, (req, res) => {
  res.json(service.helpDashboard(req.user!));
});

/**
 * @openapi
 * /help/modules:
 *   get:
 *     tags: [Help]
 *     summary: "Curated module-status register (name/letter/status/refs/owner/route + derived known-limitations count). Refs are the real confirmed value or null — never fabricated."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Module status list" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/modules", canRead, (_req, res) => {
  res.json({ modules: service.listModules() });
});

/**
 * @openapi
 * /help/articles:
 *   get:
 *     tags: [Help]
 *     summary: "List/search/filter help articles (by title/content q, module, category)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses:
 *       200: { description: "Matching help articles" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/articles", canRead, (req, res) => {
  res.json({ articles: service.listArticles(schema.helpListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/articles/{id}:
 *   get:
 *     tags: [Help]
 *     summary: "Help article detail (with metadata + related links)."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "Help article" }
 *       404: { description: "Not found" }
 */
helpRouter.get("/articles/:id", canRead, (req, res) => {
  const a = service.getArticle(param(req, "id"));
  if (!a) throw ApiError.notFound("Help article not found");
  res.json(a);
});

/**
 * @openapi
 * /help/sops:
 *   get:
 *     tags: [Help]
 *     summary: "SOP library (filter by q / module)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string } }
 *     responses:
 *       200: { description: "SOPs" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/sops", canRead, (req, res) => {
  res.json({ sops: service.listSops(schema.sopListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/sops/{id}:
 *   get:
 *     tags: [Help]
 *     summary: "SOP detail (purpose, steps, safety warnings, approval, audit expectation, smoke check)."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "SOP" }
 *       404: { description: "Not found" }
 */
helpRouter.get("/sops/:id", canRead, (req, res) => {
  const s = service.getSop(param(req, "id"));
  if (!s) throw ApiError.notFound("SOP not found");
  res.json(s);
});

/**
 * @openapi
 * /help/checklists:
 *   get:
 *     tags: [Help]
 *     summary: "Smoke-test checklist center (filter by q / module)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string } }
 *     responses:
 *       200: { description: "Checklists" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/checklists", canRead, (req, res) => {
  res.json({ checklists: service.listChecklists(schema.checklistListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/checklists/{id}:
 *   get:
 *     tags: [Help]
 *     summary: "Checklist detail (items with expected result + production-risk / do-not-test-on-real-data flags)."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "Checklist" }
 *       404: { description: "Not found" }
 */
helpRouter.get("/checklists/:id", canRead, (req, res) => {
  const c = service.getChecklist(param(req, "id"));
  if (!c) throw ApiError.notFound("Checklist not found");
  res.json(c);
});

/**
 * @openapi
 * /help/limitations:
 *   get:
 *     tags: [Help]
 *     summary: "Known-limitations register (filter by module / severity / status). Nothing hidden; future work is never marked complete."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: module, schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string, enum: [low, medium, high, critical] } }
 *       - { in: query, name: status, schema: { type: string, enum: [accepted, planned, fixed, deferred, future] } }
 *     responses:
 *       200: { description: "Known limitations" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/limitations", canRead, (req, res) => {
  res.json({ limitations: service.listLimitations(schema.limitationListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/release-notes:
 *   get:
 *     tags: [Help]
 *     summary: "Release notes (curated; PR/commit/deploy refs are real-or-null, never fabricated). Filter by module."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: module, schema: { type: string } }]
 *     responses:
 *       200: { description: "Release notes" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/release-notes", canRead, (req, res) => {
  res.json({ releaseNotes: service.listReleaseNotes(schema.releaseListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/release-notes/{id}:
 *   get:
 *     tags: [Help]
 *     summary: "Release note detail."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "Release note" }
 *       404: { description: "Not found" }
 */
helpRouter.get("/release-notes/:id", canRead, (req, res) => {
  const r = service.getReleaseNote(param(req, "id"));
  if (!r) throw ApiError.notFound("Release note not found");
  res.json(r);
});

/**
 * @openapi
 * /help/playbooks:
 *   get:
 *     tags: [Help]
 *     summary: "Emergency playbooks (filter by q / module)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: module, schema: { type: string } }
 *     responses:
 *       200: { description: "Playbooks" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/playbooks", canRead, (req, res) => {
  res.json({ playbooks: service.listPlaybooks(schema.playbookListQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/playbooks/{id}:
 *   get:
 *     tags: [Help]
 *     summary: "Playbook detail (symptoms, first checks, what-not-to-do, safe steps, escalation, recovery checklist)."
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "Playbook" }
 *       404: { description: "Not found" }
 */
helpRouter.get("/playbooks/:id", canRead, (req, res) => {
  const p = service.getPlaybook(param(req, "id"));
  if (!p) throw ApiError.notFound("Playbook not found");
  res.json(p);
});

/**
 * @openapi
 * /help/onboarding:
 *   get:
 *     tags: [Help]
 *     summary: "Super Admin onboarding guide sections (ordered)."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Onboarding sections" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/onboarding", canRead, (_req, res) => {
  res.json({ sections: service.getOnboarding() });
});

/**
 * @openapi
 * /help/search:
 *   get:
 *     tags: [Help]
 *     summary: "Global help search across every content type (filter by type + module)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: type, schema: { type: string, enum: [help, sop, checklist, playbook, release, limitation] } }
 *       - { in: query, name: module, schema: { type: string } }
 *     responses:
 *       200: { description: "Search results" }
 *       403: { description: "Missing help:read" }
 */
helpRouter.get("/search", canRead, (req, res) => {
  res.json({ results: service.search(schema.searchQuerySchema.parse(req.query)) });
});

/**
 * @openapi
 * /help/export:
 *   get:
 *     tags: [Help]
 *     summary: "Export a MASKED help snapshot (module status / checklists / limitations) as CSV or JSON. Audited (help.exported); never emits secrets/paths/tokens."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: kind, schema: { type: string, enum: [modules, checklists, limitations], default: modules } }
 *       - { in: query, name: format, schema: { type: string, enum: [csv, json], default: csv } }
 *       - { in: query, name: reason, schema: { type: string } }
 *     responses:
 *       200: { description: "A masked CSV or JSON snapshot download" }
 *       403: { description: "Missing help:export" }
 */
helpRouter.get("/export", canExport, async (req, res) => {
  const q = schema.helpExportQuerySchema.parse(req.query);
  const { buffer, filename, contentType } = await service.exportSnapshot(
    req.user!,
    { kind: q.kind, format: q.format, reason: q.reason },
    actor(req)
  );
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});
