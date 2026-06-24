import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from "./users.schema";
import * as usersService from "./users.service";

export const usersRouter = Router();

usersRouter.use(authenticate, requireTenant, requirePermission("users:manage"));

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List user accounts (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: role, schema: { type: string, enum: [admin, teacher, accountant, student, parent] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated list of users }
 *   post:
 *     tags: [Users]
 *     summary: Create a user account (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, fullName, role]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               fullName: { type: string }
 *               role: { type: string, enum: [admin, teacher, accountant, student, parent] }
 *               phone: { type: string }
 *     responses:
 *       201: { description: Created user }
 *       409: { description: Email already in use }
 */
usersRouter.get("/", async (req, res) => {
  const queryParams = listUsersQuerySchema.parse(req.query);
  const result = await usersService.listUsers(
    parsePagination(queryParams),
    {
      role: queryParams.role,
      search: queryParams.search,
    },
    tenantId(req)
  );
  res.json(result);
});

usersRouter.post("/", async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const user = await usersService.createUser(input, tenantId(req));
  res.status(201).json(user);
});

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by id (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: User }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Users]
 *     summary: Update a user (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated user }
 *   delete:
 *     tags: [Users]
 *     summary: Deactivate a user and revoke their sessions (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deactivated }
 */
usersRouter.get("/:id", async (req, res) => {
  res.json(await usersService.getUser(uuidParam(req), tenantId(req)));
});

usersRouter.patch("/:id", async (req, res) => {
  const input = updateUserSchema.parse(req.body);
  res.json(await usersService.updateUser(uuidParam(req), input, tenantId(req)));
});

usersRouter.delete("/:id", async (req, res) => {
  await usersService.deactivateUser(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /users/{id}/disable-2fa:
 *   post:
 *     tags: [Users]
 *     summary: Reset (disable) a user's two-factor authentication — admin recovery
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Two-factor reset for the user }
 *       404: { description: User not found }
 */
usersRouter.post("/:id/disable-2fa", async (req, res) => {
  await usersService.resetUserTwoFactor(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /users/{id}/unlock:
 *   post:
 *     tags: [Users]
 *     summary: Unlock a user locked out by failed logins — admin recovery
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Account unlocked }
 *       404: { description: User not found }
 */
usersRouter.post("/:id/unlock", async (req, res) => {
  await usersService.unlockUser(uuidParam(req), tenantId(req));
  res.status(204).end();
});
