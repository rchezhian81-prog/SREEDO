import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import {
  createEntrySchema,
  createPeriodSchema,
  createRoomSchema,
  exportQuerySchema,
  listEntriesQuerySchema,
  updateEntrySchema,
  updatePeriodSchema,
  updateRoomSchema,
} from "./timetable.schema";
import * as service from "./timetable.service";

export const timetableRouter = Router();

timetableRouter.use(authenticate, requireTenant);

const canRead = requirePermission("timetable:read");
const canCreate = requirePermission("timetable:create");
const canUpdate = requirePermission("timetable:update");
const canDelete = requirePermission("timetable:delete");
const canExport = requirePermission("timetable:export");

/**
 * @openapi
 * /timetable/periods:
 *   get:
 *     tags: [Timetable]
 *     summary: List the period master
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Periods ordered by sort order }
 *   post:
 *     tags: [Timetable]
 *     summary: Create a period
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, startTime, endTime]
 *             properties:
 *               name: { type: string, example: "Period 1" }
 *               startTime: { type: string, example: "08:00" }
 *               endTime: { type: string, example: "08:45" }
 *               sortOrder: { type: integer }
 *               isBreak: { type: boolean }
 *     responses:
 *       201: { description: Created period }
 *       409: { description: Duplicate period name }
 */
timetableRouter.get("/periods", canRead, async (req, res) => {
  res.json(await service.listPeriods(tenantId(req)));
});

timetableRouter.post("/periods", canCreate, async (req, res) => {
  const input = createPeriodSchema.parse(req.body);
  res.status(201).json(await service.createPeriod(input, tenantId(req)));
});

/**
 * @openapi
 * /timetable/periods/{id}:
 *   patch:
 *     tags: [Timetable]
 *     summary: Update a period
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated period }
 *   delete:
 *     tags: [Timetable]
 *     summary: Delete a period (cascades to its entries)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
timetableRouter.patch("/periods/:id", canUpdate, async (req, res) => {
  const input = updatePeriodSchema.parse(req.body);
  res.json(await service.updatePeriod(uuidParam(req), input, tenantId(req)));
});

timetableRouter.delete("/periods/:id", canDelete, async (req, res) => {
  await service.deletePeriod(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /timetable/rooms:
 *   get:
 *     tags: [Timetable]
 *     summary: List the room master
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Rooms ordered by name }
 *   post:
 *     tags: [Timetable]
 *     summary: Create a room
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string, example: "Room 101" }
 *               code: { type: string, example: "R101" }
 *               capacity: { type: integer }
 *               building: { type: string }
 *     responses:
 *       201: { description: Created room }
 *       409: { description: Duplicate room code }
 */
timetableRouter.get("/rooms", canRead, async (req, res) => {
  res.json(await service.listRooms(tenantId(req)));
});

timetableRouter.post("/rooms", canCreate, async (req, res) => {
  const input = createRoomSchema.parse(req.body);
  res.status(201).json(await service.createRoom(input, tenantId(req)));
});

/**
 * @openapi
 * /timetable/rooms/{id}:
 *   patch:
 *     tags: [Timetable]
 *     summary: Update a room
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated room }
 *   delete:
 *     tags: [Timetable]
 *     summary: Delete a room (clears it from entries)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
timetableRouter.patch("/rooms/:id", canUpdate, async (req, res) => {
  const input = updateRoomSchema.parse(req.body);
  res.json(await service.updateRoom(uuidParam(req), input, tenantId(req)));
});

timetableRouter.delete("/rooms/:id", canDelete, async (req, res) => {
  await service.deleteRoom(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /timetable/entries:
 *   get:
 *     tags: [Timetable]
 *     summary: List timetable entries (filter for a class, teacher or room timetable)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *       - { in: query, name: roomId, schema: { type: string, format: uuid } }
 *       - { in: query, name: dayOfWeek, schema: { type: integer, minimum: 1, maximum: 7 } }
 *     responses:
 *       200: { description: Entries with subject/teacher/room/period names }
 *   post:
 *     tags: [Timetable]
 *     summary: Create a timetable entry (rejects teacher/room/section clashes)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sectionId, dayOfWeek, periodId, subjectId]
 *             properties:
 *               sectionId: { type: string, format: uuid }
 *               dayOfWeek: { type: integer, minimum: 1, maximum: 7, description: "1=Monday … 7=Sunday" }
 *               periodId: { type: string, format: uuid }
 *               subjectId: { type: string, format: uuid }
 *               teacherId: { type: string, format: uuid, nullable: true }
 *               roomId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: Created entry }
 *       409: { description: Conflict — teacher/room/section already booked in that slot }
 */
timetableRouter.get("/entries", canRead, async (req, res) => {
  const filters = listEntriesQuerySchema.parse(req.query);
  res.json(await service.listEntries(filters, tenantId(req)));
});

timetableRouter.post("/entries", canCreate, async (req, res) => {
  const input = createEntrySchema.parse(req.body);
  res.status(201).json(await service.createEntry(input, tenantId(req)));
});

/**
 * @openapi
 * /timetable/entries/{id}:
 *   patch:
 *     tags: [Timetable]
 *     summary: Update a timetable entry (re-checks conflicts)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *       409: { description: Conflict in the target slot }
 *   delete:
 *     tags: [Timetable]
 *     summary: Delete a timetable entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
timetableRouter.patch("/entries/:id", canUpdate, async (req, res) => {
  const input = updateEntrySchema.parse(req.body);
  res.json(await service.updateEntry(uuidParam(req), input, tenantId(req)));
});

timetableRouter.delete("/entries/:id", canDelete, async (req, res) => {
  await service.deleteEntry(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /timetable/export:
 *   get:
 *     tags: [Timetable]
 *     summary: Export a class or teacher timetable as CSV
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sectionId, schema: { type: string, format: uuid } }
 *       - { in: query, name: teacherId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: CSV file, content: { text/csv: {} } }
 */
timetableRouter.get("/export", canExport, async (req, res) => {
  const filters = exportQuerySchema.parse(req.query);
  const csv = await service.exportCsv(filters, tenantId(req));
  res.type("text/csv").attachment("timetable.csv").send(csv);
});
