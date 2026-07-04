import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { param, uuidParam } from "../../utils/params";
import { clientIp } from "../../utils/security-audit";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import { recordAudit } from "./platform.service";
import * as service from "./security.service";
import {
  apiTokenCreateSchema,
  complianceReportQuerySchema,
  dashboardQuerySchema,
  failedSummaryQuerySchema,
  highRiskQuerySchema,
  ipAllowlistAddSchema,
  ipAllowlistToggleSchema,
  loginHistoryQuerySchema,
  passwordPolicySchema,
  reasonSchema,
  reportExportQuerySchema,
  sessionsQuerySchema,
  twoFaComplianceQuerySchema,
  twoFaPolicySchema,
} from "./security.schema";

/**
 * Super Admin P — Platform Security & Compliance Center routes.
 *
 * Hard boundary: authenticate + authorize("super_admin"). Granular RBAC (module
 * H) on top: reads need platform:security_read, mutations need
 * platform:security_manage. Sensitive mutations additionally pass the IP-allowlist
 * gate (a no-op unless an operator has enabled the allowlist); the allowlist
 * controls themselves are NEVER gated, so there is always a recovery path.
 */
export const platformSecurityRouter = Router();
platformSecurityRouter.use(authenticate, authorize("super_admin"));

const canRead = requirePermission("platform:security_read");
const canManage = requirePermission("platform:security_manage");

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

/** Blocks a sensitive mutation when the platform IP allowlist excludes the caller. */
async function ipGate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const ok = await service.isIpAllowed(clientIp(req));
  if (!ok) throw ApiError.forbidden("Your IP address is not permitted by the platform allowlist");
  next();
}

function sendSpreadsheet(
  res: Response,
  format: "csv" | "xlsx",
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): void {
  const headers = columns.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(toXlsx(headers, data));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(headers, data));
  }
}

// ---- A. Dashboard + alerts ----

/**
 * @openapi
 * /platform/security/summary:
 *   get: { tags: [Platform Security], summary: Security Center dashboard summary cards, security: [{ bearerAuth: [] }], responses: { 200: { description: Summary counts } } }
 */
platformSecurityRouter.get("/summary", canRead, async (req, res) => {
  res.json(await service.dashboardSummary(dashboardQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/security/alerts:
 *   get: { tags: [Platform Security], summary: Active security alerts/warnings, security: [{ bearerAuth: [] }], responses: { 200: { description: Alert list } } }
 */
platformSecurityRouter.get("/alerts", canRead, async (_req, res) => {
  res.json(await service.securityAlerts());
});

// ---- B. 2FA policy ----

/**
 * @openapi
 * /platform/security/2fa/policy:
 *   get: { tags: [Platform Security], summary: Per-role 2FA enforcement policy, security: [{ bearerAuth: [] }], responses: { 200: { description: Policy per role } } }
 */
platformSecurityRouter.get("/2fa/policy", canRead, async (_req, res) => {
  res.json(await service.get2faPolicy());
});

/**
 * @openapi
 * /platform/security/2fa/policy:
 *   put: { tags: [Platform Security], summary: Set a role's 2FA requirement (require + optional grace), security: [{ bearerAuth: [] }], responses: { 200: { description: Updated policy } } }
 */
platformSecurityRouter.put("/2fa/policy", canManage, ipGate, async (req, res) => {
  res.json(await service.set2faPolicy(twoFaPolicySchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/security/2fa/compliance:
 *   get: { tags: [Platform Security], summary: Platform users' 2FA compliance state, security: [{ bearerAuth: [] }], responses: { 200: { description: Compliance list } } }
 */
platformSecurityRouter.get("/2fa/compliance", canRead, async (req, res) => {
  res.json(await service.twoFaCompliance(twoFaComplianceQuerySchema.parse(req.query)));
});

// ---- C. Sessions ----

/**
 * @openapi
 * /platform/security/sessions:
 *   get: { tags: [Platform Security], summary: All active platform-admin sessions, security: [{ bearerAuth: [] }], responses: { 200: { description: Active sessions (no tokens) } } }
 */
platformSecurityRouter.get("/sessions", canRead, async (req, res) => {
  res.json(await service.listAllSessions(sessionsQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/security/sessions/{id}/revoke:
 *   post: { tags: [Platform Security], summary: Revoke one session (reason required), security: [{ bearerAuth: [] }], responses: { 200: { description: Revoked } } }
 */
platformSecurityRouter.post("/sessions/:id/revoke", canManage, ipGate, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await service.revokeSession(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /platform/security/users/{id}/sessions/revoke-all:
 *   post: { tags: [Platform Security], summary: Revoke all of a user's sessions (keeps caller's own), security: [{ bearerAuth: [] }], responses: { 200: { description: Count revoked } } }
 */
platformSecurityRouter.post("/users/:id/sessions/revoke-all", canManage, ipGate, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await service.revokeUserSessions(uuidParam(req), reason, actor(req), req.user!.sessionId));
});

/**
 * @openapi
 * /platform/security/roles/{roleKey}/sessions/revoke:
 *   post: { tags: [Platform Security], summary: Revoke all sessions for a role (keeps caller's own), security: [{ bearerAuth: [] }], responses: { 200: { description: Count revoked } } }
 */
platformSecurityRouter.post("/roles/:roleKey/sessions/revoke", canManage, ipGate, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(
    await service.revokeRoleSessions(
      { roleKey: param(req, "roleKey"), reason },
      actor(req),
      req.user!.sessionId
    )
  );
});

// ---- D. Login history + failed-login monitoring ----

/**
 * @openapi
 * /platform/security/login-history:
 *   get: { tags: [Platform Security], summary: Login history (success/failed), security: [{ bearerAuth: [] }], responses: { 200: { description: Paged login events } } }
 */
platformSecurityRouter.get("/login-history", canRead, async (req, res) => {
  res.json(await service.loginHistory(loginHistoryQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/security/login-history/export:
 *   get: { tags: [Platform Security], summary: Export login history (CSV/XLSX, audited), security: [{ bearerAuth: [] }], responses: { 200: { description: File } } }
 */
platformSecurityRouter.get("/login-history/export", canRead, async (req, res) => {
  const q = loginHistoryQuerySchema.parse(req.query);
  const rows = await service.loginHistoryExportRows(q);
  const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  await recordAudit(actor(req), {
    action: "security.login_history_exported",
    targetType: "platform_audit_log",
    targetId: null,
    institutionId: null,
    detail: { format, scope: q.scope, rows: rows.length },
  });
  sendSpreadsheet(res, format, "login-history", service.LOGIN_HISTORY_COLUMNS, rows);
});

/**
 * @openapi
 * /platform/security/login-history/summary:
 *   get: { tags: [Platform Security], summary: Failed-login summary by email/IP/day, security: [{ bearerAuth: [] }], responses: { 200: { description: Grouped counts } } }
 */
platformSecurityRouter.get("/login-history/summary", canRead, async (req, res) => {
  res.json(await service.failedLoginSummary(failedSummaryQuerySchema.parse(req.query)));
});

// ---- E. Locked accounts ----

/**
 * @openapi
 * /platform/security/locked-accounts:
 *   get: { tags: [Platform Security], summary: Currently locked platform accounts, security: [{ bearerAuth: [] }], responses: { 200: { description: Locked accounts } } }
 */
platformSecurityRouter.get("/locked-accounts", canRead, async (_req, res) => {
  res.json(await service.lockedAccounts());
});

/**
 * @openapi
 * /platform/security/users/{id}/lock:
 *   post: { tags: [Platform Security], summary: Lock a platform account (reason required; last owner protected), security: [{ bearerAuth: [] }], responses: { 200: { description: Locked } } }
 */
platformSecurityRouter.post("/users/:id/lock", canManage, ipGate, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await service.lockAccount(uuidParam(req), reason, actor(req)));
});

/**
 * @openapi
 * /platform/security/users/{id}/unlock:
 *   post: { tags: [Platform Security], summary: Unlock a platform account (reason required), security: [{ bearerAuth: [] }], responses: { 200: { description: Unlocked } } }
 */
platformSecurityRouter.post("/users/:id/unlock", canManage, ipGate, async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await service.unlockAccount(uuidParam(req), reason, actor(req)));
});

// ---- F. Password policy ----

/**
 * @openapi
 * /platform/security/password-policy:
 *   get: { tags: [Platform Security], summary: Password policy summary (editable + enforced baseline), security: [{ bearerAuth: [] }], responses: { 200: { description: Policy } } }
 */
platformSecurityRouter.get("/password-policy", canRead, async (_req, res) => {
  res.json(await service.getPasswordPolicy());
});

/**
 * @openapi
 * /platform/security/password-policy:
 *   put: { tags: [Platform Security], summary: Update the password policy summary (audited), security: [{ bearerAuth: [] }], responses: { 200: { description: Updated } } }
 */
platformSecurityRouter.put("/password-policy", canManage, ipGate, async (req, res) => {
  res.json(await service.setPasswordPolicy(passwordPolicySchema.parse(req.body), actor(req)));
});

// ---- G. IP allowlist (management NEVER gated — always recoverable) ----

/**
 * @openapi
 * /platform/security/ip-allowlist:
 *   get: { tags: [Platform Security], summary: IP allowlist + your current IP, security: [{ bearerAuth: [] }], responses: { 200: { description: Allowlist state } } }
 */
platformSecurityRouter.get("/ip-allowlist", canRead, async (req, res) => {
  res.json(await service.ipAllowlistState(clientIp(req)));
});

/**
 * @openapi
 * /platform/security/ip-allowlist:
 *   post: { tags: [Platform Security], summary: Add an allowed IP/CIDR, security: [{ bearerAuth: [] }], responses: { 200: { description: Allowlist state } } }
 */
platformSecurityRouter.post("/ip-allowlist", canManage, async (req, res) => {
  res.json(await service.addIpAllowlistEntry(ipAllowlistAddSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/security/ip-allowlist/{id}:
 *   delete: { tags: [Platform Security], summary: Remove an allowed IP/CIDR, security: [{ bearerAuth: [] }], responses: { 200: { description: Allowlist state } } }
 */
platformSecurityRouter.delete("/ip-allowlist/:id", canManage, async (req, res) => {
  res.json(await service.removeIpAllowlistEntry(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /platform/security/ip-allowlist/enabled:
 *   put: { tags: [Platform Security], summary: Enable/disable allowlist enforcement (refuses to lock the caller out), security: [{ bearerAuth: [] }], responses: { 200: { description: Allowlist state }, 400: { description: Would lock the caller out } } }
 */
platformSecurityRouter.put("/ip-allowlist/enabled", canManage, async (req, res) => {
  res.json(await service.setIpAllowlistEnabled(ipAllowlistToggleSchema.parse(req.body), actor(req)));
});

// ---- H. API tokens ----

/**
 * @openapi
 * /platform/security/api-tokens:
 *   get: { tags: [Platform Security], summary: List platform API tokens (never the value), security: [{ bearerAuth: [] }], responses: { 200: { description: Tokens } } }
 */
platformSecurityRouter.get("/api-tokens", canRead, async (_req, res) => {
  res.json(await service.listApiTokens());
});

/**
 * @openapi
 * /platform/security/api-tokens:
 *   post: { tags: [Platform Security], summary: Create an API token (full value returned ONCE), security: [{ bearerAuth: [] }], responses: { 201: { description: token shown once } } }
 */
platformSecurityRouter.post("/api-tokens", canManage, ipGate, async (req, res) => {
  res.status(201).json(await service.createApiToken(apiTokenCreateSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /platform/security/api-tokens/{id}/revoke:
 *   post: { tags: [Platform Security], summary: Revoke an API token, security: [{ bearerAuth: [] }], responses: { 200: { description: Revoked } } }
 */
platformSecurityRouter.post("/api-tokens/:id/revoke", canManage, ipGate, async (req, res) => {
  res.json(await service.revokeApiToken(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /platform/security/api-tokens/{id}/rotate:
 *   post: { tags: [Platform Security], summary: Rotate an API token (new value returned ONCE), security: [{ bearerAuth: [] }], responses: { 200: { description: new token shown once } } }
 */
platformSecurityRouter.post("/api-tokens/:id/rotate", canManage, ipGate, async (req, res) => {
  res.json(await service.rotateApiToken(uuidParam(req), actor(req)));
});

// ---- I. High-risk action monitor ----

/**
 * @openapi
 * /platform/security/high-risk:
 *   get: { tags: [Platform Security], summary: High-risk action feed, security: [{ bearerAuth: [] }], responses: { 200: { description: Feed } } }
 */
platformSecurityRouter.get("/high-risk", canRead, async (req, res) => {
  res.json(await service.highRiskFeed(highRiskQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/security/high-risk/export:
 *   get: { tags: [Platform Security], summary: Export the high-risk feed (CSV/XLSX, audited), security: [{ bearerAuth: [] }], responses: { 200: { description: File } } }
 */
platformSecurityRouter.get("/high-risk/export", canRead, async (req, res) => {
  const q = highRiskQuerySchema.parse(req.query);
  const rows = await service.highRiskExportRows(q);
  await recordAudit(actor(req), {
    action: "security.high_risk_exported",
    targetType: "platform_audit_log",
    targetId: null,
    institutionId: null,
    detail: { format: req.query.format === "xlsx" ? "xlsx" : "csv", rows: rows.length },
  });
  sendSpreadsheet(res, req.query.format === "xlsx" ? "xlsx" : "csv", "high-risk-actions", service.HIGH_RISK_COLUMNS, rows);
});

// ---- J. Compliance reports ----

/**
 * @openapi
 * /platform/security/reports:
 *   get: { tags: [Platform Security], summary: Run a compliance report, security: [{ bearerAuth: [] }], responses: { 200: { description: Report rows } } }
 */
platformSecurityRouter.get("/reports", canRead, async (req, res) => {
  res.json(await service.complianceReport(complianceReportQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /platform/security/reports/export:
 *   get: { tags: [Platform Security], summary: Export a compliance report (CSV/XLSX, audited; reason optional), security: [{ bearerAuth: [] }], responses: { 200: { description: File } } }
 */
platformSecurityRouter.get("/reports/export", canRead, async (req, res) => {
  const q = reportExportQuerySchema.parse(req.query);
  const { columns, rows } = await service.complianceReportExport(q);
  await recordAudit(actor(req), {
    action: "security.report_exported",
    targetType: "compliance_report",
    targetId: null,
    institutionId: null,
    detail: { report: q.report, format: q.format, rows: rows.length, reason: q.reason ?? null },
  });
  sendSpreadsheet(res, q.format, `compliance-${q.report}`, columns, rows);
});
