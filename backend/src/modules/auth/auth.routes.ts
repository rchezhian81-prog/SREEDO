import { Router } from "express";
import type { Request } from "express";
import { authenticate } from "../../middleware/auth";
import { permissionsForRole } from "../../middleware/permissions";
import { authRateLimiter } from "../../middleware/rate-limit";
import { ApiError } from "../../utils/api-error";
import { uuidParam } from "../../utils/params";
import { clientIp, recordSecurityEvent } from "../../utils/security-audit";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  getCookie,
  setAuthCookies,
} from "../../utils/cookies";
import {
  changePasswordSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
} from "./auth.schema";
import * as authService from "./auth.service";

export const authRouter = Router();

/** Session metadata captured from the request (the browser/device label). */
function sessionMeta(req: Request): { userAgent: string | null } {
  return { userAgent: req.headers["user-agent"] ?? null };
}

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password (and a 2FA code if enabled)
 *     description: "If two-factor is enabled and no valid totpCode is supplied, responds 200 with twoFactorRequired=true and no tokens; resubmit with totpCode."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *               totpCode: { type: string, description: 6-digit authenticator code (only if 2FA is enabled) }
 *     responses:
 *       200:
 *         description: "Tokens with the user profile, or twoFactorRequired=true when a second factor is needed"
 *       401:
 *         description: Invalid credentials or invalid 2FA code
 */
authRouter.post("/login", authRateLimiter, async (req, res) => {
  const { email, password, totpCode } = loginSchema.parse(req.body);
  try {
    const result = await authService.login(
      email,
      password,
      totpCode,
      sessionMeta(req)
    );
    if (!("twoFactorRequired" in result)) {
      await recordSecurityEvent({
        action: "auth.login.success",
        actorId: result.user.id,
        actorEmail: result.user.email,
        actorRole: result.user.role,
        targetId: result.user.id,
        ip: clientIp(req),
      });
    }
    res.json(result);
  } catch (err) {
    await recordSecurityEvent({
      action: "auth.login.failed",
      actorEmail: email,
      detail: { reason: err instanceof ApiError ? err.message : "error" },
      ip: clientIp(req),
    });
    throw err;
  }
});

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new token pair (rotation)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: New access and refresh tokens }
 *       401: { description: Invalid or expired refresh token }
 */
authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refresh(refreshToken, sessionMeta(req));
  res.json(result);
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke a refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       204: { description: Token revoked }
 */
authRouter.post("/logout", async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.status(204).end();
});

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset email
 *     description: Always returns 200 and never reveals whether the email exists. When the account exists, a single-use reset link is emailed (requires SMTP to be configured to deliver).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: A reset link has been sent if the account exists }
 */
authRouter.post("/forgot-password", authRateLimiter, async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(email);
  await recordSecurityEvent({
    action: "auth.password.reset_requested",
    actorEmail: email,
    ip: clientIp(req),
  });
  res.json({
    message:
      "If an account exists for that email, a password-reset link has been sent.",
  });
});

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Set a new password using a reset token
 *     description: Consumes a single-use token from the emailed link, sets the new password, and revokes all existing sessions.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       204: { description: Password reset — sign in with the new password }
 *       400: { description: Invalid or expired reset link }
 */
authRouter.post("/reset-password", authRateLimiter, async (req, res) => {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, newPassword);
  await recordSecurityEvent({
    action: "auth.password.reset_completed",
    ip: clientIp(req),
  });
  res.status(204).end();
});

/**
 * @openapi
 * /auth/portal/login:
 *   post:
 *     tags: [Auth]
 *     summary: Portal login for students/parents — sets httpOnly auth cookies
 *     description: Tokens are returned as httpOnly cookies (not in the body). Staff must use /auth/login.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *               totpCode: { type: string }
 *     responses:
 *       200: { description: "user object with Set-Cookie tokens, or twoFactorRequired=true" }
 *       401: { description: Invalid credentials }
 *       403: { description: Not a student/parent account }
 */
authRouter.post("/portal/login", authRateLimiter, async (req, res) => {
  const { email, password, totpCode } = loginSchema.parse(req.body);
  const result = await authService.login(
    email,
    password,
    totpCode,
    sessionMeta(req)
  );
  if ("twoFactorRequired" in result) {
    res.json(result);
    return;
  }
  if (result.user.role !== "student" && result.user.role !== "parent") {
    // Staff accounts must use the Bearer flow at /auth/login.
    await authService.logout(result.refreshToken);
    throw ApiError.forbidden("Use the staff sign-in for this account");
  }
  setAuthCookies(res, result.accessToken, result.refreshToken);
  res.json({ user: result.user });
});

/**
 * @openapi
 * /auth/portal/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the portal session from the refresh cookie
 *     responses:
 *       200: { description: "{ user } with refreshed cookies" }
 *       401: { description: Missing/invalid refresh cookie }
 */
authRouter.post("/portal/refresh", async (req, res) => {
  const token = getCookie(req, REFRESH_COOKIE);
  if (!token) throw ApiError.unauthorized();
  try {
    const result = await authService.refresh(token, sessionMeta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.json({ user: result.user });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
});

/**
 * @openapi
 * /auth/portal/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the portal session and clear cookies
 *     responses:
 *       204: { description: Logged out }
 */
authRouter.post("/portal/logout", async (req, res) => {
  const token = getCookie(req, REFRESH_COOKIE);
  if (token) await authService.logout(token);
  clearAuthCookies(res);
  res.status(204).end();
});

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the authenticated user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: User profile }
 *       401: { description: Not authenticated }
 */
authRouter.get("/me", authenticate, async (req, res) => {
  const profile = await authService.getProfile(req.user!.id);
  res.json(profile);
});

/**
 * @openapi
 * /auth/permissions:
 *   get:
 *     tags: [Auth]
 *     summary: Effective permission keys for the authenticated user's role
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ role, permissions: string[] }" }
 *       401: { description: Not authenticated }
 */
authRouter.get("/permissions", authenticate, async (req, res) => {
  const role = req.user!.role;
  res.json({ role, permissions: await permissionsForRole(role) });
});

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change the authenticated user's password (revokes all sessions)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       204: { description: Password changed }
 */
authRouter.post("/change-password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user!.id, currentPassword, newPassword);
  await recordSecurityEvent({
    action: "auth.password.changed",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    institutionId: req.user!.institutionId ?? null,
    targetId: req.user!.id,
    ip: clientIp(req),
  });
  res.status(204).end();
});

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List the caller's active sessions (devices)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active sessions, the current one flagged, newest activity first }
 *       401: { description: Not authenticated }
 */
authRouter.get("/sessions", authenticate, async (req, res) => {
  res.json(
    await authService.listSessions(req.user!.id, req.user!.sessionId)
  );
});

/**
 * @openapi
 * /auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Revoke one of the caller's sessions (sign out that device)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Session revoked }
 *       404: { description: Session not found }
 */
authRouter.delete("/sessions/:id", authenticate, async (req, res) => {
  await authService.revokeSession(req.user!.id, uuidParam(req));
  res.status(204).end();
});

/**
 * @openapi
 * /auth/2fa/status:
 *   get:
 *     tags: [Auth]
 *     summary: Whether two-factor authentication is enabled for the caller
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Whether two-factor is enabled" }
 */
authRouter.get("/2fa/status", authenticate, async (req, res) => {
  res.json(await authService.twoFactorStatus(req.user!.id));
});

/**
 * @openapi
 * /auth/2fa/setup:
 *   post:
 *     tags: [Auth]
 *     summary: Begin two-factor enrollment — returns a secret + otpauth URI
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Returns secret and otpauthUrl to add to an authenticator app, then call enable" }
 *       400: { description: Already enabled }
 */
authRouter.post("/2fa/setup", authenticate, async (req, res) => {
  res.json(await authService.beginTwoFactorSetup(req.user!.id));
});

/**
 * @openapi
 * /auth/2fa/enable:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm a code and turn on two-factor authentication
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, description: 6-digit code from the authenticator app }
 *     responses:
 *       204: { description: Two-factor enabled }
 *       400: { description: Invalid code or setup not started }
 */
authRouter.post("/2fa/enable", authenticate, async (req, res) => {
  const { code } = enableTwoFactorSchema.parse(req.body);
  await authService.enableTwoFactor(req.user!.id, code);
  await recordSecurityEvent({
    action: "auth.2fa.enabled",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    institutionId: req.user!.institutionId ?? null,
    targetId: req.user!.id,
    ip: clientIp(req),
  });
  res.status(204).end();
});

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     tags: [Auth]
 *     summary: Turn off two-factor authentication (requires the account password)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       204: { description: Two-factor disabled }
 *       400: { description: Incorrect password }
 */
authRouter.post("/2fa/disable", authenticate, async (req, res) => {
  const { password } = disableTwoFactorSchema.parse(req.body);
  await authService.disableTwoFactor(req.user!.id, password);
  await recordSecurityEvent({
    action: "auth.2fa.disabled",
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    institutionId: req.user!.institutionId ?? null,
    targetId: req.user!.id,
    ip: clientIp(req),
  });
  res.status(204).end();
});
