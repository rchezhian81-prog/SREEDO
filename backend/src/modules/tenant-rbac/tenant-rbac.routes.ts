import { Router } from "express";
import type { Request } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { param, uuidParam } from "../../utils/params";
import { updateRoleSchema, auditQuerySchema, assignJobRoleSchema } from "./tenant-rbac.schema";
import * as service from "./tenant-rbac.service";

/**
 * PR-T2 — Tenant RBAC v2. The tenant-side counterpart to the platform RBAC
 * console (/platform/rbac). Manages per-tenant role permission overrides. All
 * routes are tenant-scoped (super_admin has no institution context and is
 * rejected by requireTenant); management routes require tenant_rbac:manage.
 */
export const tenantRbacRouter = Router();
tenantRbacRouter.use(authenticate, requireTenant);

const READ = requirePermission("tenant_rbac:read");
const MANAGE = requirePermission("tenant_rbac:manage");

function actorFrom(req: Request): service.ActorContext {
  return {
    userId: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    institutionId: tenantId(req),
    ip: req.ip,
    userAgent: req.get("user-agent") ?? null,
  };
}

/**
 * @openapi
 * /tenant-rbac/registry:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: The tenant permission registry (groups, roles, high-risk keys)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Registry }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/registry", READ, (_req, res) => {
  res.json(service.getRegistry());
});

/**
 * @openapi
 * /tenant-rbac/me:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: The calling tenant user's effective permissions (console bootstrap)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ role, isAdmin, permissions }" }
 */
tenantRbacRouter.get("/me", async (req, res) => {
  res.json(await service.effectiveForUser(req.user!));
});

/**
 * @openapi
 * /tenant-rbac/roles:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: The tenant's roles with effective/overridden permission counts
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Roles }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/roles", READ, async (req, res) => {
  res.json(await service.listRoles(tenantId(req)));
});

/**
 * @openapi
 * /tenant-rbac/matrix:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: Roles × permissions effective matrix for the tenant
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Matrix }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/matrix", READ, async (req, res) => {
  res.json(await service.getMatrix(tenantId(req)));
});

/**
 * @openapi
 * /tenant-rbac/job-roles:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: The assignable finer job-roles (with per-tenant effective/override counts)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Job roles }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/job-roles", READ, async (req, res) => {
  res.json(await service.listJobRoles(tenantId(req)));
});

/**
 * @openapi
 * /tenant-rbac/users/{userId}/job-role:
 *   post:
 *     tags: [Tenant RBAC]
 *     summary: Assign (or clear) a user's finer job-role
 *     description: >
 *       Sets users.job_role_key and the coarse role to the job-role's base role.
 *       jobRoleKey=null clears it. Portal (student/parent) accounts are rejected;
 *       the last manager/owner cannot be demoted; an actor cannot self-demote.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jobRoleKey]
 *             properties: { jobRoleKey: { type: string, nullable: true } }
 *     responses:
 *       200: { description: Updated user role }
 *       400: { description: Safety rail violated }
 *       403: { description: Missing tenant_rbac:manage }
 *       404: { description: User or job-role not found }
 */
tenantRbacRouter.post("/users/:userId/job-role", MANAGE, async (req, res) => {
  const { jobRoleKey } = assignJobRoleSchema.parse(req.body);
  res.json(
    await service.assignJobRole(tenantId(req), uuidParam(req, "userId"), jobRoleKey, actorFrom(req))
  );
});

/**
 * @openapi
 * /tenant-rbac/audit:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: Tenant RBAC audit trail (paginated)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: Audit events }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/audit", READ, async (req, res) => {
  const q = auditQuerySchema.parse(req.query);
  const limit = q.limit ?? 50;
  const offset = ((q.page ?? 1) - 1) * limit;
  res.json(await service.listAudit(tenantId(req), { limit, offset }));
});

/**
 * @openapi
 * /tenant-rbac/roles/{role}:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: One role's permission matrix (effective / default / override state)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: role, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Role detail }
 *       403: { description: Missing tenant_rbac:read }
 *       404: { description: Unknown tenant role }
 */
tenantRbacRouter.get("/roles/:role", READ, async (req, res) => {
  res.json(await service.getRole(tenantId(req), param(req, "role")));
});

/**
 * @openapi
 * /tenant-rbac/roles/{role}/users:
 *   get:
 *     tags: [Tenant RBAC]
 *     summary: Users holding this role within the tenant
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: role, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Users in role }
 *       403: { description: Missing tenant_rbac:read }
 */
tenantRbacRouter.get("/roles/:role/users", READ, async (req, res) => {
  res.json(await service.usersInRole(tenantId(req), param(req, "role")));
});

/**
 * @openapi
 * /tenant-rbac/roles/{role}:
 *   put:
 *     tags: [Tenant RBAC]
 *     summary: Replace a role's permissions (stored as per-tenant overrides)
 *     description: >
 *       Body carries the full desired set of registry permission keys for the
 *       role; the server stores the diff vs the global defaults. High-risk
 *       changes require a reason. Safety rails prevent granting admin
 *       permissions to portal roles, stripping the admin role's management keys,
 *       and self-lockout.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: role, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [permissions]
 *             properties:
 *               permissions: { type: array, items: { type: string } }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Updated role detail }
 *       400: { description: Safety rail violated or reason required }
 *       403: { description: Missing tenant_rbac:manage }
 *       404: { description: Unknown tenant role }
 */
tenantRbacRouter.put("/roles/:role", MANAGE, async (req, res) => {
  const body = updateRoleSchema.parse(req.body);
  res.json(
    await service.updateRole(
      tenantId(req),
      param(req, "role"),
      body.permissions,
      body.reason ?? null,
      actorFrom(req)
    )
  );
});

/**
 * @openapi
 * /tenant-rbac/roles/{role}/reset:
 *   post:
 *     tags: [Tenant RBAC]
 *     summary: Reset a role to its global defaults (clears per-tenant overrides)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: role, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Role detail after reset }
 *       403: { description: Missing tenant_rbac:manage }
 *       404: { description: Unknown tenant role }
 */
tenantRbacRouter.post("/roles/:role/reset", MANAGE, async (req, res) => {
  res.json(await service.resetRole(tenantId(req), param(req, "role"), actorFrom(req)));
});
