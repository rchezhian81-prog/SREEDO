import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createMenuItemSchema,
  updateMenuItemSchema,
  listMenuQuerySchema,
} from "./mess.schema";
import * as service from "./mess.service";

// Cafeteria / mess menu management — institution-admin only, tenant-scoped.
// (Students & parents read the menu through the portal router.)
export const messRouter = Router();
messRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /cafeteria/menu:
 *   get:
 *     tags: [Cafeteria]
 *     summary: List mess menu items (filter by day of week / meal)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: dayOfWeek, schema: { type: integer, minimum: 0, maximum: 6 } }
 *       - { in: query, name: meal, schema: { type: string, enum: [breakfast, lunch, snacks, dinner] } }
 *     responses:
 *       200: { description: Paginated menu items }
 *   post:
 *     tags: [Cafeteria]
 *     summary: Add a mess menu item
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dayOfWeek, meal, items]
 *             properties:
 *               dayOfWeek: { type: integer, minimum: 0, maximum: 6 }
 *               meal: { type: string, enum: [breakfast, lunch, snacks, dinner] }
 *               items: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Created menu item }
 */
messRouter.get("/menu", async (req, res) => {
  const params = listMenuQuerySchema.parse(req.query);
  res.json(await service.listMenuItems(parsePagination(params), params, tenantId(req)));
});

messRouter.post("/menu", async (req, res) => {
  const input = createMenuItemSchema.parse(req.body);
  res.status(201).json(await service.createMenuItem(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /cafeteria/menu/{id}:
 *   get:
 *     tags: [Cafeteria]
 *     summary: Get one menu item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Menu item }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Cafeteria]
 *     summary: Update a menu item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated menu item }
 *   delete:
 *     tags: [Cafeteria]
 *     summary: Delete a menu item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
messRouter.get("/menu/:id", async (req, res) => {
  res.json(await service.getMenuItem(uuidParam(req), tenantId(req)));
});

messRouter.patch("/menu/:id", async (req, res) => {
  const input = updateMenuItemSchema.parse(req.body);
  res.json(await service.updateMenuItem(uuidParam(req), input, tenantId(req)));
});

messRouter.delete("/menu/:id", async (req, res) => {
  await service.deleteMenuItem(uuidParam(req), tenantId(req));
  res.status(204).end();
});
