import { Router } from "express";
import { param } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { helpListQuerySchema, helpSearchQuerySchema } from "./tenanthelp.schema";
import * as service from "./tenanthelp.service";

// PR-T10 — Tenant Help/SOP Center. Read-only curated docs for TENANT staff,
// gated by tenant_help:read (granted to admin/teacher/accountant + all jr_*
// staff job-roles; never student/parent). Entirely separate from the platform
// Help Center: different mount (/tenant-help), different permission namespace —
// the super-admin /help surface stays platform-only and untouched.
export const tenantHelpRouter = Router();
tenantHelpRouter.use(authenticate, requireTenant, requirePermission("tenant_help:read"));

/**
 * @openapi
 * /tenant-help/summary:
 *   get:
 *     tags: [Tenant Help]
 *     summary: Corpus counts + last-updated for the caller's institution type
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Summary } }
 */
tenantHelpRouter.get("/summary", async (req, res) => {
  res.json(await service.summary(tenantId(req)));
});

/**
 * @openapi
 * /tenant-help/getting-started:
 *   get:
 *     tags: [Tenant Help]
 *     summary: Guided setup sections (filtered to the institution's type)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Sections } }
 */
tenantHelpRouter.get("/getting-started", async (req, res) => {
  res.json(await service.gettingStarted(tenantId(req)));
});

/**
 * @openapi
 * /tenant-help/articles:
 *   get:
 *     tags: [Tenant Help]
 *     summary: List help articles (mode-filtered; optional q / category)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses: { 200: { description: Articles } }
 */
tenantHelpRouter.get("/articles", async (req, res) => {
  const filters = helpListQuerySchema.parse(req.query);
  res.json(await service.listArticles(tenantId(req), filters));
});

/**
 * @openapi
 * /tenant-help/articles/{id}:
 *   get:
 *     tags: [Tenant Help]
 *     summary: One help article by its stable id
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Article }, 404: { description: Unknown or out-of-mode id } }
 */
tenantHelpRouter.get("/articles/:id", async (req, res) => {
  res.json(await service.getArticle(tenantId(req), param(req, "id")));
});

/**
 * @openapi
 * /tenant-help/sops:
 *   get:
 *     tags: [Tenant Help]
 *     summary: List SOPs (mode-filtered; optional q / category)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses: { 200: { description: SOPs } }
 */
tenantHelpRouter.get("/sops", async (req, res) => {
  const filters = helpListQuerySchema.parse(req.query);
  res.json(await service.listSops(tenantId(req), filters));
});

/**
 * @openapi
 * /tenant-help/sops/{id}:
 *   get:
 *     tags: [Tenant Help]
 *     summary: One SOP by its stable id
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: SOP }, 404: { description: Unknown or out-of-mode id } }
 */
tenantHelpRouter.get("/sops/:id", async (req, res) => {
  res.json(await service.getSop(tenantId(req), param(req, "id")));
});

/**
 * @openapi
 * /tenant-help/search:
 *   get:
 *     tags: [Tenant Help]
 *     summary: Search across articles, SOPs and getting-started
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *       - { in: query, name: type, schema: { type: string, enum: [article, sop, getting-started] } }
 *     responses: { 200: { description: Typed hits with snippets } }
 */
tenantHelpRouter.get("/search", async (req, res) => {
  const { q, type } = helpSearchQuerySchema.parse(req.query);
  res.json(await service.search(tenantId(req), q, type));
});
