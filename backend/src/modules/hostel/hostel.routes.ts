import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  createAllocationSchema,
  createBlockSchema,
  createHostelSchema,
  createRoomSchema,
  generateInvoicesSchema,
  setFeeSchema,
  transferSchema,
  updateBlockSchema,
  updateHostelSchema,
  updateRoomSchema,
} from "./hostel.schema";
import * as service from "./hostel.service";

export const hostelRouter = Router();

hostelRouter.use(authenticate, requireTenant);

const canRead = requirePermission("hostel:read");
const canCreate = requirePermission("hostel:create");
const canUpdate = requirePermission("hostel:update");
const canDelete = requirePermission("hostel:delete");
const canAllocate = requirePermission("hostel:allocate");
const canFees = requirePermission("hostel:fees");

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/**
 * @openapi
 * /hostel/hostels:
 *   get:
 *     tags: [Hostel]
 *     summary: List hostels (with room/bed counts + current occupancy)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Hostels } }
 *   post:
 *     tags: [Hostel]
 *     summary: Create a hostel
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string }
 *               code: { type: string }
 *               type: { type: string, enum: [boys, girls, co_ed, staff] }
 *               address: { type: string }
 *               wardenName: { type: string }
 *               wardenPhone: { type: string }
 *               contactPhone: { type: string }
 *               capacity: { type: integer }
 *     responses:
 *       201: { description: Created hostel }
 *       409: { description: Duplicate code }
 */
hostelRouter.get("/hostels", canRead, async (req, res) => {
  res.json(await service.listHostels(tenantId(req)));
});
hostelRouter.post("/hostels", canCreate, async (req, res) => {
  res.status(201).json(await service.createHostel(createHostelSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/hostels/{id}:
 *   patch:
 *     tags: [Hostel]
 *     summary: Update a hostel
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Hostel]
 *     summary: Delete a hostel (cascades blocks/rooms/allocations)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
hostelRouter.patch("/hostels/:id", canUpdate, async (req, res) => {
  res.json(await service.updateHostel(uuidParam(req), updateHostelSchema.parse(req.body), tenantId(req)));
});
hostelRouter.delete("/hostels/:id", canDelete, async (req, res) => {
  await service.deleteHostel(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /hostel/hostels/{hostelId}/blocks:
 *   get:
 *     tags: [Hostel]
 *     summary: List a hostel's blocks
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: hostelId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Blocks } }
 *   post:
 *     tags: [Hostel]
 *     summary: Add a block to a hostel
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: hostelId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string } } } } }
 *     responses:
 *       201: { description: Created block }
 *       409: { description: Duplicate block name }
 */
hostelRouter.get("/hostels/:hostelId/blocks", canRead, async (req, res) => {
  res.json(await service.listBlocks(uuidParam(req, "hostelId"), tenantId(req)));
});
hostelRouter.post("/hostels/:hostelId/blocks", canCreate, async (req, res) => {
  res.status(201).json(await service.createBlock(uuidParam(req, "hostelId"), createBlockSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/blocks/{id}:
 *   patch:
 *     tags: [Hostel]
 *     summary: Update a block
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Hostel]
 *     summary: Delete a block
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
hostelRouter.patch("/blocks/:id", canUpdate, async (req, res) => {
  res.json(await service.updateBlock(uuidParam(req), updateBlockSchema.parse(req.body), tenantId(req)));
});
hostelRouter.delete("/blocks/:id", canDelete, async (req, res) => {
  await service.deleteBlock(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /hostel/hostels/{hostelId}/rooms:
 *   get:
 *     tags: [Hostel]
 *     summary: List a hostel's rooms (with occupied + available beds)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: hostelId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Rooms } }
 *   post:
 *     tags: [Hostel]
 *     summary: Add a room
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: hostelId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roomNumber]
 *             properties:
 *               roomNumber: { type: string }
 *               blockId: { type: string, format: uuid, nullable: true }
 *               floor: { type: string }
 *               roomType: { type: string, example: "2-sharing" }
 *               capacity: { type: integer, example: 2 }
 *               status: { type: string, enum: [available, occupied, maintenance, inactive] }
 *     responses:
 *       201: { description: Created room }
 *       409: { description: Duplicate room number }
 */
hostelRouter.get("/hostels/:hostelId/rooms", canRead, async (req, res) => {
  res.json(await service.listRooms(uuidParam(req, "hostelId"), tenantId(req)));
});
hostelRouter.post("/hostels/:hostelId/rooms", canCreate, async (req, res) => {
  res.status(201).json(await service.createRoom(uuidParam(req, "hostelId"), createRoomSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/rooms/{id}:
 *   patch:
 *     tags: [Hostel]
 *     summary: Update a room (number/type/capacity/status)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Hostel]
 *     summary: Delete a room (blocked if occupied)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
hostelRouter.patch("/rooms/:id", canUpdate, async (req, res) => {
  res.json(await service.updateRoom(uuidParam(req), updateRoomSchema.parse(req.body), tenantId(req)));
});
hostelRouter.delete("/rooms/:id", canDelete, async (req, res) => {
  await service.deleteRoom(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /hostel/allocations:
 *   get:
 *     tags: [Hostel]
 *     summary: List allocations (filter by hostel/room/status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: hostelId, schema: { type: string, format: uuid } }
 *       - { in: query, name: roomId, schema: { type: string, format: uuid } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, vacated, transferred] } }
 *     responses: { 200: { description: Allocations } }
 *   post:
 *     tags: [Hostel]
 *     summary: Allocate a student to a hostel room/bed
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, hostelId, roomId]
 *             properties:
 *               studentId: { type: string, format: uuid }
 *               hostelId: { type: string, format: uuid }
 *               roomId: { type: string, format: uuid }
 *               bedNo: { type: string }
 *               allocationDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created allocation }
 *       409: { description: Room full / student already allocated / bed taken }
 */
hostelRouter.get("/allocations", canRead, async (req, res) => {
  res.json(
    await service.listAllocations(tenantId(req), {
      hostelId: optStr(req.query.hostelId),
      roomId: optStr(req.query.roomId),
      status: optStr(req.query.status),
    })
  );
});
hostelRouter.post("/allocations", canAllocate, async (req, res) => {
  res.status(201).json(await service.createAllocation(createAllocationSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/allocations/{id}/transfer:
 *   post:
 *     tags: [Hostel]
 *     summary: Transfer a student to another room (closes the current allocation)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [roomId], properties: { roomId: { type: string, format: uuid }, bedNo: { type: string } } }
 *     responses:
 *       200: { description: New allocation }
 *       409: { description: Target room full }
 */
hostelRouter.post("/allocations/:id/transfer", canAllocate, async (req, res) => {
  res.json(await service.transferAllocation(uuidParam(req), transferSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/allocations/{id}/vacate:
 *   post:
 *     tags: [Hostel]
 *     summary: Vacate an active allocation
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Vacated } }
 */
hostelRouter.post("/allocations/:id/vacate", canAllocate, async (req, res) => {
  res.json(await service.vacateAllocation(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /hostel/allocations/{id}:
 *   delete:
 *     tags: [Hostel]
 *     summary: Delete an allocation record
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
hostelRouter.delete("/allocations/:id", canDelete, async (req, res) => {
  await service.deleteAllocation(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /hostel/fees:
 *   get:
 *     tags: [Hostel]
 *     summary: List hostel fees (hostel/room-type level)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: hostelId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Fees } }
 *   post:
 *     tags: [Hostel]
 *     summary: Set a hostel- or room-type-level fee (upsert)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hostelId, amount]
 *             properties:
 *               hostelId: { type: string, format: uuid }
 *               roomType: { type: string, nullable: true }
 *               amount: { type: number }
 *               frequency: { type: string, enum: [monthly, term, annual] }
 *     responses: { 200: { description: Fee saved } }
 */
hostelRouter.get("/fees", canRead, async (req, res) => {
  res.json(await service.listFees(tenantId(req), optStr(req.query.hostelId)));
});
hostelRouter.post("/fees", canFees, async (req, res) => {
  res.json(await service.setFee(setFeeSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/fees/{id}:
 *   delete:
 *     tags: [Hostel]
 *     summary: Delete a hostel fee mapping
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
hostelRouter.delete("/fees/:id", canFees, async (req, res) => {
  await service.deleteFee(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /hostel/fees/generate:
 *   post:
 *     tags: [Hostel]
 *     summary: Generate hostel-fee invoices for active allocations (idempotent per student+period)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dueDate, period]
 *             properties:
 *               hostelId: { type: string, format: uuid, description: "limit to one hostel" }
 *               dueDate: { type: string, format: date }
 *               period: { type: string, example: "2026-07" }
 *               description: { type: string }
 *     responses:
 *       200: { description: "{ generated, skipped }" }
 */
hostelRouter.post("/fees/generate", canFees, async (req, res) => {
  res.json(await service.generateInvoices(generateInvoicesSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /hostel/students/{studentId}/allocation:
 *   get:
 *     tags: [Hostel]
 *     summary: A student's own active hostel allocation (owner-scoped, for the portal)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: studentId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "Allocation detail (hostel/room/bed/warden) or null" }
 *       403: { description: Not the student's own record }
 */
hostelRouter.get("/students/:studentId/allocation", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await service.studentAllocation(studentId, tenantId(req)));
});
