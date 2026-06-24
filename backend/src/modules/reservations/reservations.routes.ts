import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import { listReservationsQuerySchema, updateReservationSchema } from "./reservations.schema";
import * as service from "./reservations.service";

// Library reservations — admin/librarian management, tenant-scoped.
// (Students place & cancel reservations through the portal router.)
export const reservationsRouter = Router();
reservationsRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /reservations:
 *   get:
 *     tags: [Reservations]
 *     summary: List book reservations (filter by status, search book/student)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, fulfilled, cancelled, expired] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated reservations (pending first) }
 */
reservationsRouter.get("/", async (req, res) => {
  const params = listReservationsQuerySchema.parse(req.query);
  res.json(await service.listReservations(parsePagination(params), params, tenantId(req)));
});

/**
 * @openapi
 * /reservations/{id}:
 *   patch:
 *     tags: [Reservations]
 *     summary: Resolve a pending reservation (fulfil or cancel)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [fulfilled, cancelled] }
 *     responses:
 *       200: { description: Updated reservation }
 *       404: { description: Pending reservation not found }
 */
reservationsRouter.patch("/:id", async (req, res) => {
  const input = updateReservationSchema.parse(req.body);
  res.json(await service.updateReservationStatus(uuidParam(req), input, tenantId(req), req.user!.id));
});
