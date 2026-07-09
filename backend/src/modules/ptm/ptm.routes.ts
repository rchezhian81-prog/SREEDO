import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createMeetingSchema,
  updateMeetingSchema,
  listMeetingsQuerySchema,
  generateSlotsSchema,
  bookingSchema,
  updateBookingSchema,
  inviteSchema,
} from "./ptm.schema";
import * as service from "./ptm.service";

// PR-T8 — PTM / Parent Meetings. Staff surface gated by ptm:read / ptm:manage;
// the /my/* parent surface is guardian-scoped (a parent may only see/book for
// their own linked children) and needs no ptm:* grant. Tenant-scoped throughout.
export const ptmRouter = Router();
ptmRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip ?? null,
});

// ---- Parent (guardian-scoped) — declared before /meetings/:id to avoid clashes ----

/**
 * @openapi
 * /ptm/my:
 *   get:
 *     tags: [PTM]
 *     summary: Scheduled meetings targeting the caller's children + their bookings (parent)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: "{ meetings, bookings }" } }
 */
ptmRouter.get("/my", async (req, res) => {
  res.json(await service.listMeetingsForParent(req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /ptm/my/meetings/{id}/slots:
 *   get:
 *     tags: [PTM]
 *     summary: Open slots for a meeting the caller's child is invited to (parent, guardian-gated)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Slots }, 403: { description: Not open to your children } }
 */
ptmRouter.get("/my/meetings/:id/slots", async (req, res) => {
  res.json(await service.parentMeetingSlots(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /ptm/my/bookings:
 *   post:
 *     tags: [PTM]
 *     summary: Book a slot for one of the caller's children (parent, guardian-scoped)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [slotId, studentId], properties: { slotId: { type: string, format: uuid }, studentId: { type: string, format: uuid } } } } }
 *     responses: { 201: { description: Booking }, 400: { description: Slot full / already booked }, 403: { description: Not your child } }
 */
ptmRouter.post("/my/bookings", async (req, res) => {
  const input = bookingSchema.parse(req.body);
  res.status(201).json(await service.parentBook(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /ptm/my/bookings/{id}:
 *   delete:
 *     tags: [PTM]
 *     summary: Cancel the caller's own booking (parent)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Cancelled }, 403: { description: Not your booking } }
 */
ptmRouter.delete("/my/bookings/:id", async (req, res) => {
  await service.cancelBooking(uuidParam(req), tenantId(req), { userId: req.user!.id, isStaff: false });
  res.status(204).end();
});

// ---- Staff (ptm:read / ptm:manage) ----

/**
 * @openapi
 * /ptm/meetings:
 *   get:
 *     tags: [PTM]
 *     summary: List parent-teacher meetings (filter by status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, scheduled, completed, cancelled] } }
 *     responses: { 200: { description: Paginated meetings } }
 *   post:
 *     tags: [PTM]
 *     summary: Schedule a PTM (audience = section/class/semester/batch/all_parents)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, meetingDate]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               meetingDate: { type: string, format: date }
 *               venue: { type: string }
 *               mode: { type: string, enum: [in_person, online] }
 *               joinLink: { type: string }
 *               audienceType: { type: string, enum: [all_parents, section, class, semester, batch] }
 *               audienceRef: { type: string, format: uuid }
 *     responses: { 201: { description: Created meeting } }
 */
ptmRouter.get("/meetings", requirePermission("ptm:read"), async (req, res) => {
  const params = listMeetingsQuerySchema.parse(req.query);
  res.json(await service.listMeetings(parsePagination(params), params, tenantId(req)));
});

ptmRouter.post("/meetings", requirePermission("ptm:manage"), async (req, res) => {
  const input = createMeetingSchema.parse(req.body);
  const created = await service.createMeeting(input, tenantId(req), req.user!.id);
  const c = created as Record<string, unknown>;
  await recordAudit(actorOf(req), {
    action: "ptm.meeting.create", targetType: "ptm_meeting", targetId: c.id as string,
    institutionId: tenantId(req), detail: { title: c.title, audienceType: c.audienceType },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /ptm/meetings/{id}:
 *   get: { tags: [PTM], summary: Meeting detail (slots + bookings), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Meeting } } }
 *   patch: { tags: [PTM], summary: Update / publish / cancel a meeting, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [PTM], summary: Delete a meeting, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted } } }
 */
ptmRouter.get("/meetings/:id", requirePermission("ptm:read"), async (req, res) => {
  res.json(await service.getMeeting(uuidParam(req), tenantId(req)));
});

ptmRouter.patch("/meetings/:id", requirePermission("ptm:manage"), async (req, res) => {
  const input = updateMeetingSchema.parse(req.body);
  const id = uuidParam(req);
  const updated = await service.updateMeeting(id, input, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "ptm.meeting.update", targetType: "ptm_meeting", targetId: id,
    institutionId: tenantId(req), detail: { fields: Object.keys(input), status: input.status },
  });
  res.json(updated);
});

ptmRouter.delete("/meetings/:id", requirePermission("ptm:manage"), async (req, res) => {
  const id = uuidParam(req);
  await service.deleteMeeting(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "ptm.meeting.delete", targetType: "ptm_meeting", targetId: id, institutionId: tenantId(req), detail: {},
  });
  res.status(204).end();
});

/**
 * @openapi
 * /ptm/meetings/{id}/summary:
 *   get: { tags: [PTM], summary: Per-meeting counts (slots, booked, attended, no-show), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Summary } } }
 */
ptmRouter.get("/meetings/:id/summary", requirePermission("ptm:read"), async (req, res) => {
  res.json(await service.meetingSummary(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /ptm/meetings/{id}/slots:
 *   post:
 *     tags: [PTM]
 *     summary: Generate one or more bookable slots for a teacher
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [teacherId, startsAt, endsAt], properties: { teacherId: { type: string, format: uuid }, startsAt: { type: string }, endsAt: { type: string }, slotMinutes: { type: integer }, capacity: { type: integer } } } } }
 *     responses: { 201: { description: "{ created, slots }" } }
 */
ptmRouter.post("/meetings/:id/slots", requirePermission("ptm:manage"), async (req, res) => {
  const input = generateSlotsSchema.parse(req.body);
  res.status(201).json(await service.generateSlots(uuidParam(req), input, tenantId(req)));
});

/**
 * @openapi
 * /ptm/slots/{id}:
 *   delete: { tags: [PTM], summary: Delete a slot (no active bookings), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted }, 400: { description: Has active bookings } } }
 */
ptmRouter.delete("/slots/:id", requirePermission("ptm:manage"), async (req, res) => {
  await service.deleteSlot(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /ptm/meetings/{id}/invite:
 *   post:
 *     tags: [PTM]
 *     summary: Send invites to the meeting's parent audience (reuses communication; degrades gracefully)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: "{ sent, recipients }" } }
 */
ptmRouter.post("/meetings/:id/invite", requirePermission("ptm:manage"), async (req, res) => {
  const input = inviteSchema.parse(req.body);
  const id = uuidParam(req);
  const result = await service.sendInvite(id, input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "ptm.invite.send", targetType: "ptm_meeting", targetId: id,
    institutionId: tenantId(req), detail: { recipients: result.recipients },
  });
  res.json(result);
});

/**
 * @openapi
 * /ptm/bookings:
 *   post:
 *     tags: [PTM]
 *     summary: Book a student into a slot on their behalf (staff)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [slotId, studentId], properties: { slotId: { type: string, format: uuid }, studentId: { type: string, format: uuid } } } } }
 *     responses: { 201: { description: Booking } }
 */
ptmRouter.post("/bookings", requirePermission("ptm:manage"), async (req, res) => {
  const input = bookingSchema.parse(req.body);
  res.status(201).json(await service.staffBook(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /ptm/bookings/{id}:
 *   patch:
 *     tags: [PTM]
 *     summary: Record attendance / notes for a booking (staff)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { status: { type: string, enum: [booked, attended, no_show, cancelled] }, notes: { type: string } } } } }
 *     responses: { 200: { description: Updated booking } }
 *   delete:
 *     tags: [PTM]
 *     summary: Cancel a booking (staff)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Cancelled } }
 */
ptmRouter.patch("/bookings/:id", requirePermission("ptm:manage"), async (req, res) => {
  const input = updateBookingSchema.parse(req.body);
  const id = uuidParam(req);
  const updated = await service.updateBooking(id, input, tenantId(req));
  if (input.status === "attended" || input.status === "no_show") {
    await recordAudit(actorOf(req), {
      action: "ptm.attendance.record", targetType: "ptm_booking", targetId: id,
      institutionId: tenantId(req), detail: { status: input.status },
    });
  }
  res.json(updated);
});

ptmRouter.delete("/bookings/:id", requirePermission("ptm:manage"), async (req, res) => {
  await service.cancelBooking(uuidParam(req), tenantId(req), { userId: req.user!.id, isStaff: true });
  res.status(204).end();
});
