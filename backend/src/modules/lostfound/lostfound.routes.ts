import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createItemSchema,
  updateItemSchema,
  listItemsQuerySchema,
} from "./lostfound.schema";
import * as service from "./lostfound.service";

// Lost & Found register — part of the unified front office (PR-T7). Gated by the
// shared front_office:* namespace (read/manage) instead of authorize("admin");
// admin keeps access via the 0107 grant. Tenant-scoped.
export const lostFoundRouter = Router();
lostFoundRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /lost-found:
 *   get:
 *     tags: [Lost & Found]
 *     summary: List lost & found items (filter by type / status, search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: type, schema: { type: string, enum: [lost, found] } }
 *       - { in: query, name: status, schema: { type: string, enum: [open, claimed, returned, closed] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated items (open first) }
 *   post:
 *     tags: [Lost & Found]
 *     summary: Log a lost or found item
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               type: { type: string, enum: [lost, found] }
 *               title: { type: string }
 *               description: { type: string }
 *               location: { type: string }
 *               reporterName: { type: string }
 *               reporterContact: { type: string }
 *               itemDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created item }
 */
lostFoundRouter.get("/", requirePermission("front_office:read"), async (req, res) => {
  const params = listItemsQuerySchema.parse(req.query);
  res.json(await service.listItems(parsePagination(params), params, tenantId(req)));
});

lostFoundRouter.post("/", requirePermission("front_office:manage"), async (req, res) => {
  const input = createItemSchema.parse(req.body);
  res.status(201).json(await service.createItem(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /lost-found/{id}:
 *   get:
 *     tags: [Lost & Found]
 *     summary: Get one item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Item }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Lost & Found]
 *     summary: Update an item (status / details)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated item }
 *   delete:
 *     tags: [Lost & Found]
 *     summary: Delete an item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
lostFoundRouter.get("/:id", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.getItem(uuidParam(req), tenantId(req)));
});

lostFoundRouter.patch("/:id", requirePermission("front_office:manage"), async (req, res) => {
  const input = updateItemSchema.parse(req.body);
  res.json(await service.updateItem(uuidParam(req), input, tenantId(req)));
});

lostFoundRouter.delete("/:id", requirePermission("front_office:manage"), async (req, res) => {
  const id = uuidParam(req);
  await service.deleteItem(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "frontoffice.lostfound.delete",
    targetType: "lost_found_item",
    targetId: id,
    institutionId: tenantId(req),
    detail: {},
  });
  res.status(204).end();
});
