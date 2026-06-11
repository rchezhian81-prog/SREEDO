import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { parsePagination } from "../../utils/pagination";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from "./users.schema";
import * as usersService from "./users.service";

export const usersRouter = Router();

usersRouter.use(authenticate, authorize("admin"));

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
  const result = await usersService.listUsers(parsePagination(queryParams), {
    role: queryParams.role,
    search: queryParams.search,
  });
  res.json(result);
});

usersRouter.post("/", async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const user = await usersService.createUser(input);
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
  res.json(await usersService.getUser(uuidParam(req)));
});

usersRouter.patch("/:id", async (req, res) => {
  const input = updateUserSchema.parse(req.body);
  res.json(await usersService.updateUser(uuidParam(req), input));
});

usersRouter.delete("/:id", async (req, res) => {
  await usersService.deactivateUser(uuidParam(req));
  res.status(204).end();
});
