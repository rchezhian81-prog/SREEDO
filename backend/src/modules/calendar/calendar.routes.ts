import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from "./calendar.schema";
import * as service from "./calendar.service";

// Calendar is readable by any tenant user; only admins create/edit events.
export const calendarRouter = Router();
calendarRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /calendar/events:
 *   get:
 *     tags: [Calendar]
 *     summary: List calendar events (filter by type / date range)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [holiday, event, exam, meeting, other] } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Events in range (array) }
 *   post:
 *     tags: [Calendar]
 *     summary: Create a calendar event (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, eventDate]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               eventDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               type: { type: string, enum: [holiday, event, exam, meeting, other] }
 *               allDay: { type: boolean }
 *     responses:
 *       201: { description: Created event }
 */
calendarRouter.get("/events", async (req, res) => {
  const filters = listEventsQuerySchema.parse(req.query);
  res.json(await service.listEvents(filters, tenantId(req)));
});

calendarRouter.post("/events", authorize("admin"), async (req, res) => {
  const input = createEventSchema.parse(req.body);
  res.status(201).json(await service.createEvent(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /calendar/events/{id}:
 *   get:
 *     tags: [Calendar]
 *     summary: Get one event
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Event }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Calendar]
 *     summary: Update an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated event }
 *   delete:
 *     tags: [Calendar]
 *     summary: Delete an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
calendarRouter.get("/events/:id", async (req, res) => {
  res.json(await service.getEvent(uuidParam(req), tenantId(req)));
});

calendarRouter.patch("/events/:id", authorize("admin"), async (req, res) => {
  const input = updateEventSchema.parse(req.body);
  res.json(await service.updateEvent(uuidParam(req), input, tenantId(req)));
});

calendarRouter.delete("/events/:id", authorize("admin"), async (req, res) => {
  await service.deleteEvent(uuidParam(req), tenantId(req));
  res.status(204).end();
});
