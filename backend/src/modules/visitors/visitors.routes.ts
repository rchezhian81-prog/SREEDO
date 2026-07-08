import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import {
  createVisitorSchema,
  updateVisitorSchema,
  listVisitorsQuerySchema,
} from "./visitors.schema";
import * as service from "./visitors.service";

// Front-office visitor log — institution-admin only, scoped to the tenant.
export const visitorsRouter = Router();
visitorsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /visitors:
 *   get:
 *     tags: [Visitors]
 *     summary: List visitor log entries (filter by active/search/date)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: active, schema: { type: string, enum: ["true", "false"] }, description: "true = currently checked in" }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated visitor entries }
 *   post:
 *     tags: [Visitors]
 *     summary: Check in a visitor
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [visitorName]
 *             properties:
 *               visitorName: { type: string }
 *               phone: { type: string }
 *               purpose: { type: string }
 *               whomToMeet: { type: string }
 *               badgeNo: { type: string }
 *     responses:
 *       201: { description: Checked-in visitor entry }
 */
visitorsRouter.get("/", requirePermission("front_office:read"), async (req, res) => {
  const params = listVisitorsQuerySchema.parse(req.query);
  res.json(await service.listVisitors(parsePagination(params), params, tenantId(req)));
});

visitorsRouter.post("/", requirePermission("front_office:manage"), async (req, res) => {
  const input = createVisitorSchema.parse(req.body);
  res.status(201).json(await service.createVisitor(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /visitors/{id}/checkout:
 *   post:
 *     tags: [Visitors]
 *     summary: Check a visitor out (records leave time)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *       400: { description: Already checked out }
 */
visitorsRouter.post("/:id/checkout", requirePermission("front_office:manage"), async (req, res) => {
  res.json(await service.checkoutVisitor(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /visitors/{id}:
 *   get:
 *     tags: [Visitors]
 *     summary: Get one visitor entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Visitor entry }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Visitors]
 *     summary: Update a visitor entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *   delete:
 *     tags: [Visitors]
 *     summary: Delete a visitor entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
visitorsRouter.get("/:id", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.getVisitor(uuidParam(req), tenantId(req)));
});

visitorsRouter.patch("/:id", requirePermission("front_office:manage"), async (req, res) => {
  const input = updateVisitorSchema.parse(req.body);
  res.json(await service.updateVisitor(uuidParam(req), input, tenantId(req)));
});

visitorsRouter.delete("/:id", requirePermission("front_office:manage"), async (req, res) => {
  await service.deleteVisitor(uuidParam(req), tenantId(req));
  res.status(204).end();
});
