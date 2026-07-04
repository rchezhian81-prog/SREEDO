import type { Request } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { platformIpGate } from "../../middleware/platform-ip-gate";
import {
  requirePermission,
  effectivePermissions,
  isFullAccessPlatformUser,
} from "../../middleware/permissions";
import { clientIp } from "../../utils/security-audit";
import { param, uuidParam } from "../../utils/params";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { recordAudit } from "./platform.service";
import * as service from "./rbac.service";
import {
  archiveRoleSchema,
  assignRoleSchema,
  createRoleSchema,
  exportQuerySchema,
  listRolesQuerySchema,
  rbacAuditQuerySchema,
  saveMatrixSchema,
  updateRoleSchema,
} from "./rbac.schema";

export const platformRbacRouter = Router();
platformRbacRouter.use(authenticate, authorize("super_admin"));
// Platform IP allowlist (no-op unless an operator enabled a non-empty list).
platformRbacRouter.use(platformIpGate);

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});
const canRead = requirePermission("platform:rbac_read");
const canManage = requirePermission("platform:rbac_manage");

/**
 * @openapi
 * /platform/rbac/me:
 *   get: { tags: [RBAC], summary: The caller's effective platform role + permissions, security: [{ bearerAuth: [] }], responses: { 200: { description: "{ role, platformRole, isOwner, permissions }" } } }
 */
platformRbacRouter.get("/me", async (req, res) => {
  const permissions = await effectivePermissions(req.user!);
  const isOwner = await isFullAccessPlatformUser(req.user!.id);
  res.json({ role: req.user!.role, isOwner, permissions });
});

/**
 * @openapi
 * /platform/rbac/registry:
 *   get: { tags: [RBAC], summary: Permission registry grouped by module, security: [{ bearerAuth: [] }], responses: { 200: { description: Groups } } }
 */
platformRbacRouter.get("/registry", canRead, async (_req, res) => {
  res.json(await service.permissionRegistry());
});

/**
 * @openapi
 * /platform/rbac/matrix:
 *   get: { tags: [RBAC], summary: Roles × permissions matrix, security: [{ bearerAuth: [] }], responses: { 200: { description: Matrix } } }
 */
platformRbacRouter.get("/matrix", canRead, async (_req, res) => {
  res.json(await service.roleMatrix());
});

/**
 * @openapi
 * /platform/rbac/audit:
 *   get: { tags: [RBAC], summary: RBAC change history, security: [{ bearerAuth: [] }], responses: { 200: { description: Audit } } }
 */
platformRbacRouter.get("/audit", canRead, async (req, res) => {
  res.json(await service.rbacAudit(rbacAuditQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/rbac/export:
 *   get: { tags: [RBAC], summary: Export the roles × permissions matrix (CSV/XLSX), security: [{ bearerAuth: [] }], responses: { 200: { description: File } } }
 */
platformRbacRouter.get("/export", canRead, async (req, res) => {
  const { format } = exportQuerySchema.parse(req.query);
  const rows = await service.exportMatrixRows();
  const headers = service.EXPORT_COLUMNS.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => service.EXPORT_COLUMNS.map((c) => (r[c.key] ?? "") as Cell));
  await recordAudit(actor(req), {
    action: "rbac.matrix_exported",
    targetType: "rbac_matrix",
    targetId: null,
    institutionId: null,
    detail: { format },
  });
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rbac-matrix.xlsx"`);
    res.send(toXlsx(headers, data));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rbac-matrix.csv"`);
    res.send(toCsv(headers, data));
  }
});

/**
 * @openapi
 * /platform/rbac/roles:
 *   get: { tags: [RBAC], summary: List roles, security: [{ bearerAuth: [] }], responses: { 200: { description: Roles } } }
 *   post: { tags: [RBAC], summary: Create a custom role (optionally copy from a template), security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
platformRbacRouter.get("/roles", canRead, async (req, res) => {
  res.json(await service.listRoles(listRolesQuerySchema.parse(req.query)));
});
platformRbacRouter.post("/roles", canManage, async (req, res) => {
  res.status(201).json(await service.createRole(createRoleSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/rbac/roles/{key}:
 *   get: { tags: [RBAC], summary: Role detail + permissions, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Role }, 404: { description: Not found } } }
 *   patch: { tags: [RBAC], summary: Edit a role (name/description/status), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 */
platformRbacRouter.get("/roles/:key", canRead, async (req, res) => {
  res.json(await service.roleDetail(param(req, "key")));
});
platformRbacRouter.patch("/roles/:key", canManage, async (req, res) => {
  res.json(await service.updateRole(param(req, "key"), updateRoleSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/rbac/roles/{key}/archive:
 *   post: { tags: [RBAC], summary: Archive a custom role (reason required; blocked if users assigned), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Archived } } }
 */
platformRbacRouter.post("/roles/:key/archive", canManage, async (req, res) => {
  res.json(await service.archiveRole(param(req, "key"), archiveRoleSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/rbac/roles/{key}/permissions:
 *   get: { tags: [RBAC], summary: Users assigned to this role, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Users } } }
 *   put: { tags: [RBAC], summary: Save the role's full permission set (diff + reason for high-risk; audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: key, required: true, schema: { type: string } }], responses: { 200: { description: Updated } } }
 */
platformRbacRouter.put("/roles/:key/permissions", canManage, async (req, res) => {
  res.json(await service.saveRolePermissions(param(req, "key"), saveMatrixSchema.parse(req.body), actor(req)));
});
platformRbacRouter.get("/roles/:key/users", canRead, async (req, res) => {
  res.json(await service.usersInRole(param(req, "key")));
});

/**
 * @openapi
 * /platform/rbac/users/{userId}/role:
 *   post: { tags: [RBAC], summary: Assign an RBAC role to a platform admin (reason required, audited, last-owner protected), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: userId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Assigned } } }
 */
platformRbacRouter.post("/users/:userId/role", canManage, async (req, res) => {
  res.json(await service.assignRoleToUser(uuidParam(req, "userId"), assignRoleSchema.parse(req.body), actor(req)));
});
