import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createVisitSchema,
  updateVisitSchema,
  listVisitsQuerySchema,
} from "./infirmary.schema";
import * as service from "./infirmary.service";

// Infirmary / health log — institution-admin (nurse/office) only, tenant-scoped.
export const infirmaryRouter = Router();
infirmaryRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /infirmary/visits:
 *   get:
 *     tags: [Infirmary]
 *     summary: List clinic visits (filter by search / date range)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated visits }
 *   post:
 *     tags: [Infirmary]
 *     summary: Record a clinic visit
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [patientName, visitDate]
 *             properties:
 *               patientName: { type: string }
 *               studentId: { type: string, format: uuid }
 *               visitDate: { type: string, format: date }
 *               complaint: { type: string }
 *               treatment: { type: string }
 *               temperature: { type: string }
 *               remarks: { type: string }
 *     responses:
 *       201: { description: Created visit }
 */
infirmaryRouter.get("/visits", async (req, res) => {
  const params = listVisitsQuerySchema.parse(req.query);
  res.json(await service.listVisits(parsePagination(params), params, tenantId(req)));
});

infirmaryRouter.post("/visits", async (req, res) => {
  const input = createVisitSchema.parse(req.body);
  res.status(201).json(await service.createVisit(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /infirmary/visits/{id}:
 *   get:
 *     tags: [Infirmary]
 *     summary: Get one visit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Visit }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Infirmary]
 *     summary: Update a visit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated visit }
 *   delete:
 *     tags: [Infirmary]
 *     summary: Delete a visit
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
infirmaryRouter.get("/visits/:id", async (req, res) => {
  res.json(await service.getVisit(uuidParam(req), tenantId(req)));
});

infirmaryRouter.patch("/visits/:id", async (req, res) => {
  const input = updateVisitSchema.parse(req.body);
  res.json(await service.updateVisit(uuidParam(req), input, tenantId(req)));
});

infirmaryRouter.delete("/visits/:id", async (req, res) => {
  await service.deleteVisit(uuidParam(req), tenantId(req));
  res.status(204).end();
});
