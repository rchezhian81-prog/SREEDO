import type { Request } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { clientIp } from "../../utils/security-audit";
import { uuidParam } from "../../utils/params";
import * as service from "./platform-admins.service";
import {
  acceptInviteSchema,
  assignRoleSchema,
  inviteSchema,
  listAdminsQuerySchema,
  loginHistoryQuerySchema,
  reasonSchema,
  securityConfigSchema,
  setActiveSchema,
  revokeSessionSchema,
} from "./platform-admins.schema";

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

// ---- Public: accept a platform-team invite (invitee is not logged in) ----
export const platformInviteAcceptRouter = Router();
/**
 * @openapi
 * /platform/invite/accept:
 *   post: { tags: [Platform Admins], summary: Accept a platform-team invite and set a password, responses: { 200: { description: Account created } } }
 */
platformInviteAcceptRouter.post("/invite/accept", async (req, res) => {
  res.json(await service.acceptInvite(acceptInviteSchema.parse(req.body)));
});

// ---- Guarded: platform-team management (super_admin + platform:manage_admins) ----
export const platformAdminsRouter = Router();
platformAdminsRouter.use(authenticate, authorize("super_admin"), requirePermission("platform:manage_admins"));

/**
 * @openapi
 * /platform/admins/summary:
 *   get: { tags: [Platform Admins], summary: Platform-team counts (active/disabled/locked/2FA/pending invites), security: [{ bearerAuth: [] }], responses: { 200: { description: Summary } } }
 */
platformAdminsRouter.get("/summary", async (_req, res) => {
  res.json(await service.platformAdminSummary());
});

/**
 * @openapi
 * /platform/admins/login-history:
 *   get: { tags: [Platform Admins], summary: Login history (successful + failed) with IP/device, security: [{ bearerAuth: [] }], responses: { 200: { description: Paged events } } }
 */
platformAdminsRouter.get("/login-history", async (req, res) => {
  res.json(await service.loginHistory(loginHistoryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/admins/security-config:
 *   get: { tags: [Platform Admins], summary: Platform security policy (force 2FA), security: [{ bearerAuth: [] }], responses: { 200: { description: Config } } }
 *   put: { tags: [Platform Admins], summary: Update platform security policy (audited), security: [{ bearerAuth: [] }], responses: { 200: { description: Updated } } }
 */
platformAdminsRouter.get("/security-config", async (_req, res) => {
  res.json(await service.getSecurityConfig());
});
platformAdminsRouter.put("/security-config", async (req, res) => {
  res.json(await service.setSecurityConfig(securityConfigSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/admins/invites:
 *   get: { tags: [Platform Admins], summary: List platform-team invites, security: [{ bearerAuth: [] }], responses: { 200: { description: Invites } } }
 *   post: { tags: [Platform Admins], summary: Invite an internal platform admin, security: [{ bearerAuth: [] }], responses: { 200: { description: Invite created } } }
 */
platformAdminsRouter.get("/invites", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await service.listInvites(status));
});
platformAdminsRouter.post("/invites", async (req, res) => {
  res.status(201).json(await service.invitePlatformAdmin(inviteSchema.parse(req.body), actor(req)));
});
/**
 * @openapi
 * /platform/admins/invites/{id}/resend:
 *   post: { tags: [Platform Admins], summary: Resend a pending invite, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Resent } } }
 */
platformAdminsRouter.post("/invites/:id/resend", async (req, res) => {
  res.json(await service.resendInvite(uuidParam(req), actor(req)));
});
/**
 * @openapi
 * /platform/admins/invites/{id}/cancel:
 *   post: { tags: [Platform Admins], summary: Cancel a pending invite, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Cancelled } } }
 */
platformAdminsRouter.post("/invites/:id/cancel", async (req, res) => {
  await service.cancelInvite(uuidParam(req), actor(req));
  res.status(204).end();
});

/**
 * @openapi
 * /platform/admins:
 *   get: { tags: [Platform Admins], summary: List platform-team users (search/filter/sort/paginate), security: [{ bearerAuth: [] }], responses: { 200: { description: Admins } } }
 */
platformAdminsRouter.get("/", async (req, res) => {
  res.json(await service.listPlatformAdmins(listAdminsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/admins/{id}:
 *   get: { tags: [Platform Admins], summary: Platform admin detail, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Admin }, 404: { description: Not found } } }
 */
platformAdminsRouter.get("/:id", async (req, res) => {
  res.json(await service.platformAdminDetail(uuidParam(req)));
});

/**
 * @openapi
 * /platform/admins/{id}/active:
 *   patch: { tags: [Platform Admins], summary: Enable or disable an admin (reason required, audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
platformAdminsRouter.patch("/:id/active", async (req, res) => {
  res.json(await service.setActive(uuidParam(req), setActiveSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/admins/{id}/lock:
 *   post: { tags: [Platform Admins], summary: Lock an admin account (reason required, audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Locked } } }
 */
platformAdminsRouter.post("/:id/lock", async (req, res) => {
  res.json(await service.setLock(uuidParam(req), true, reasonSchema.parse(req.body), actor(req)));
});
/**
 * @openapi
 * /platform/admins/{id}/unlock:
 *   post: { tags: [Platform Admins], summary: Unlock an admin account (reason required, audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Unlocked } } }
 */
platformAdminsRouter.post("/:id/unlock", async (req, res) => {
  res.json(await service.setLock(uuidParam(req), false, reasonSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/admins/{id}/role:
 *   post: { tags: [Platform Admins], summary: Assign a platform role (reason required, audited; last owner protected), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
platformAdminsRouter.post("/:id/role", async (req, res) => {
  res.json(await service.assignRole(uuidParam(req), assignRoleSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/admins/{id}/reset-2fa:
 *   post: { tags: [Platform Admins], summary: Reset an admin's 2FA (reason required, audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Reset } } }
 */
platformAdminsRouter.post("/:id/reset-2fa", async (req, res) => {
  res.json(await service.reset2fa(uuidParam(req), reasonSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/admins/{id}/sessions:
 *   get: { tags: [Platform Admins], summary: Active sessions for an admin, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Sessions } } }
 */
platformAdminsRouter.get("/:id/sessions", async (req, res) => {
  res.json(await service.listAdminSessions(uuidParam(req)));
});
/**
 * @openapi
 * /platform/admins/{id}/sessions/{sid}:
 *   delete: { tags: [Platform Admins], summary: Revoke one session (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: path, name: sid, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Revoked } } }
 */
platformAdminsRouter.delete("/:id/sessions/:sid", async (req, res) => {
  await service.revokeAdminSession(uuidParam(req), uuidParam(req, "sid"), actor(req));
  res.status(204).end();
});
/**
 * @openapi
 * /platform/admins/{id}/sessions/revoke-all:
 *   post: { tags: [Platform Admins], summary: Revoke all sessions for an admin (audited), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ revoked }" } } }
 */
platformAdminsRouter.post("/:id/sessions/revoke-all", async (req, res) => {
  revokeSessionSchema.parse(req.body ?? {});
  res.json(await service.revokeAllAdminSessions(uuidParam(req), actor(req)));
});
