import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { permissionsForRole } from "../../middleware/permissions";
import { authRateLimiter } from "../../middleware/rate-limit";
import { ApiError } from "../../utils/api-error";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  getCookie,
  setAuthCookies,
} from "../../utils/cookies";
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
} from "./auth.schema";
import * as authService from "./auth.service";

export const authRouter = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
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
 *     responses:
 *       200:
 *         description: Access and refresh tokens with the user profile
 *       401:
 *         description: Invalid credentials
 */
authRouter.post("/login", authRateLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.login(email, password);
  res.json(result);
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
  const result = await authService.refresh(refreshToken);
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
 *     responses:
 *       200: { description: "{ user } with Set-Cookie access/refresh tokens" }
 *       401: { description: Invalid credentials }
 *       403: { description: Not a student/parent account }
 */
authRouter.post("/portal/login", authRateLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.login(email, password);
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
    const result = await authService.refresh(token);
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
  res.status(204).end();
});
