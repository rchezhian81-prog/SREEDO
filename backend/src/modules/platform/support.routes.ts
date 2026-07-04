import type { Request } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { uuidParam } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import type { Actor } from "./platform.service";
import * as service from "./support.service";
import {
  listQuerySchema,
  revokeByOperatorSchema,
  revokeByTenantSchema,
  revokeSchema,
  startSchema,
  summaryQuerySchema,
} from "./support.schema";

/**
 * Super Admin G — Support Access console routes.
 *
 * Owns /platform/support/* (mounted BEFORE the catch-all platform router). Hard
 * gate at router level: authenticate + authorize("super_admin"); granular RBAC per
 * route on top — reads need platform:support_read, start/end needs
 * platform:support_start, revoke needs platform:support_revoke. Read-only over an
 * append-only store: no endpoint here ever hard-deletes a support session.
 *
 * Route order: every literal path is registered BEFORE `/sessions/:id`.
 */
export const platformSupportRouter = Router();
platformSupportRouter.use(authenticate, authorize("super_admin"));

const canRead = requirePermission("platform:support_read");
const canStart = requirePermission("platform:support_start");
const canRevoke = requirePermission("platform:support_revoke");

const actor = (req: Request): Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/**
 * @openapi
 * /platform/support/summary:
 *   get: { tags: [Platform Support], summary: "Support-access dashboard cards (active/started/ended/expired/revoked, high-risk, by operator/tenant, avg duration, nearing-expiry, recent audit)", security: [{ bearerAuth: [] }], responses: { 200: { description: Summary cards } } }
 */
platformSupportRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.summary(summaryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/support/templates:
 *   get: { tags: [Platform Support], summary: "Static reference lists for the UI (reason templates, module keys, scopes)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ templates, modules, scopes }" } } }
 */
platformSupportRouter.get("/templates", canRead, (_req, res) => {
  res.json(service.templates());
});

/**
 * @openapi
 * /platform/support/security-summary:
 *   get: { tags: [Platform Support], summary: "Security-Center support posture (active, long-running, recently revoked, high-risk) — data only", security: [{ bearerAuth: [] }], responses: { 200: { description: Security posture } } }
 */
platformSupportRouter.get("/security-summary", canRead, async (_req, res) => {
  res.json(await service.securitySummary());
});

/**
 * @openapi
 * /platform/support/sessions/active:
 *   get: { tags: [Platform Support], summary: "Currently-live support sessions (post expiry-sweep)", security: [{ bearerAuth: [] }], responses: { 200: { description: Active sessions } } }
 */
platformSupportRouter.get("/sessions/active", canRead, async (_req, res) => {
  res.json(await service.listActive());
});

/**
 * @openapi
 * /platform/support/sessions:
 *   get: { tags: [Platform Support], summary: "Support session history (filters: date/tenant/target/operator/status/scope/template; paginate/sort)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 *   post: { tags: [Platform Support], summary: "Start a governed, scope-enforced support session (reason + expiry required; audited; returns a scoped imp token, never secrets)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ token, expiresAt, session, user }" }, 400: { description: Invalid target/reason/expiry }, 409: { description: An active session already exists } } }
 */
platformSupportRouter.get("/sessions", canRead, async (req, res) => {
  res.json(await service.listSessions(listQuerySchema.parse(req.query)));
});
platformSupportRouter.post("/sessions", canStart, async (req, res) => {
  const result = await service.startSupportSession(startSchema.parse(req.body), actor(req), {
    ip: clientIp(req),
    userAgent: req.get("user-agent") ?? null,
  });
  res.json(result);
});

/**
 * @openapi
 * /platform/support/sessions/{id}:
 *   get: { tags: [Platform Support], summary: "Single support session detail (secret-masked; ended-by/revoked-by resolved)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Session detail }, 404: { description: Not found } } }
 */
platformSupportRouter.get("/sessions/:id", canRead, async (req, res) => {
  res.json(await service.getSession(uuidParam(req)));
});

/**
 * @openapi
 * /platform/support/sessions/{id}/end:
 *   post: { tags: [Platform Support], summary: "End a support session (audited; idempotent)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ ended }" } } }
 */
platformSupportRouter.post("/sessions/:id/end", canStart, async (req, res) => {
  res.json(await service.endSupportSession({ sessionId: uuidParam(req) }, actor(req)));
});

/**
 * @openapi
 * /platform/support/sessions/{id}/revoke:
 *   post: { tags: [Platform Support], summary: "Revoke a support session (reason required; immediate access loss; audited). No hard delete.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ revoked, alreadyInactive }" }, 404: { description: Not found } } }
 */
platformSupportRouter.post("/sessions/:id/revoke", canRevoke, async (req, res) => {
  const { reason } = revokeSchema.parse(req.body);
  res.json(await service.revokeSession(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /platform/support/revoke-by-operator:
 *   post: { tags: [Platform Support], summary: "Revoke every active session for one operator (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ revoked }" } } }
 */
platformSupportRouter.post("/revoke-by-operator", canRevoke, async (req, res) => {
  const { operatorId, reason } = revokeByOperatorSchema.parse(req.body);
  res.json(await service.revokeByOperator(operatorId, reason, actor(req)));
});

/**
 * @openapi
 * /platform/support/revoke-by-tenant:
 *   post: { tags: [Platform Support], summary: "Revoke every active session touching one tenant (reason required; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ revoked }" } } }
 */
platformSupportRouter.post("/revoke-by-tenant", canRevoke, async (req, res) => {
  const { institutionId, reason } = revokeByTenantSchema.parse(req.body);
  res.json(await service.revokeByTenant(institutionId, reason, actor(req)));
});
