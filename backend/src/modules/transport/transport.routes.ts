import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  createAllocationSchema,
  createDriverSchema,
  createRouteSchema,
  createStopSchema,
  createTripSchema,
  createVehicleSchema,
  generateInvoicesSchema,
  setFeeSchema,
  updateAllocationSchema,
  updateDriverSchema,
  updateRouteSchema,
  updateStopSchema,
  updateTripSchema,
  updateVehicleSchema,
} from "./transport.schema";
import * as service from "./transport.service";

export const transportRouter = Router();

transportRouter.use(authenticate, requireTenant);

const canRead = requirePermission("transport:read");
const canCreate = requirePermission("transport:create");
const canUpdate = requirePermission("transport:update");
const canDelete = requirePermission("transport:delete");
const canAllocate = requirePermission("transport:allocate");
const canFees = requirePermission("transport:fees");

const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/**
 * @openapi
 * /transport/vehicles:
 *   get:
 *     tags: [Transport]
 *     summary: List vehicles (with expiry fields + route counts)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Vehicles }
 *   post:
 *     tags: [Transport]
 *     summary: Create a vehicle
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [registrationNo]
 *             properties:
 *               registrationNo: { type: string, example: "KA-01-AB-1234" }
 *               type: { type: string, example: Bus }
 *               capacity: { type: integer, example: 40 }
 *               insuranceExpiry: { type: string, format: date }
 *               fitnessExpiry: { type: string, format: date }
 *               permitExpiry: { type: string, format: date }
 *     responses:
 *       201: { description: Created vehicle }
 *       409: { description: Duplicate registration }
 */
transportRouter.get("/vehicles", canRead, async (req, res) => {
  res.json(await service.listVehicles(tenantId(req)));
});
transportRouter.post("/vehicles", canCreate, async (req, res) => {
  res.status(201).json(await service.createVehicle(createVehicleSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/vehicles/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update a vehicle
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Transport]
 *     summary: Delete a vehicle
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.patch("/vehicles/:id", canUpdate, async (req, res) => {
  res.json(await service.updateVehicle(uuidParam(req), updateVehicleSchema.parse(req.body), tenantId(req)));
});
transportRouter.delete("/vehicles/:id", canDelete, async (req, res) => {
  await service.deleteVehicle(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/drivers:
 *   get:
 *     tags: [Transport]
 *     summary: List drivers (with license expiry + helper details)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Drivers } }
 *   post:
 *     tags: [Transport]
 *     summary: Create a driver
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               licenseNumber: { type: string }
 *               licenseExpiry: { type: string, format: date }
 *               helperName: { type: string }
 *               helperPhone: { type: string }
 *     responses: { 201: { description: Created driver } }
 */
transportRouter.get("/drivers", canRead, async (req, res) => {
  res.json(await service.listDrivers(tenantId(req)));
});
transportRouter.post("/drivers", canCreate, async (req, res) => {
  res.status(201).json(await service.createDriver(createDriverSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/drivers/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update a driver
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Transport]
 *     summary: Delete a driver
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.patch("/drivers/:id", canUpdate, async (req, res) => {
  res.json(await service.updateDriver(uuidParam(req), updateDriverSchema.parse(req.body), tenantId(req)));
});
transportRouter.delete("/drivers/:id", canDelete, async (req, res) => {
  await service.deleteDriver(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/routes:
 *   get:
 *     tags: [Transport]
 *     summary: List routes (with vehicle/driver + stop/student counts)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Routes } }
 *   post:
 *     tags: [Transport]
 *     summary: Create a route (optionally assign a vehicle + driver)
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
 *               vehicleId: { type: string, format: uuid, nullable: true }
 *               driverId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: Created route }
 *       409: { description: Duplicate code }
 */
transportRouter.get("/routes", canRead, async (req, res) => {
  res.json(await service.listRoutes(tenantId(req)));
});
transportRouter.post("/routes", canCreate, async (req, res) => {
  res.status(201).json(await service.createRoute(createRouteSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/routes/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update a route
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Transport]
 *     summary: Delete a route (cascades stops/allocations)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.patch("/routes/:id", canUpdate, async (req, res) => {
  res.json(await service.updateRoute(uuidParam(req), updateRouteSchema.parse(req.body), tenantId(req)));
});
transportRouter.delete("/routes/:id", canDelete, async (req, res) => {
  await service.deleteRoute(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/routes/{routeId}/stops:
 *   get:
 *     tags: [Transport]
 *     summary: List a route's stops (ordered)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: routeId, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Stops } }
 *   post:
 *     tags: [Transport]
 *     summary: Add a stop to a route
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: routeId, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               stopOrder: { type: integer }
 *               pickupTime: { type: string, example: "07:30" }
 *               dropTime: { type: string, example: "15:30" }
 *               distanceKm: { type: number }
 *               zone: { type: string }
 *     responses:
 *       201: { description: Created stop }
 *       409: { description: Duplicate stop name on the route }
 */
transportRouter.get("/routes/:routeId/stops", canRead, async (req, res) => {
  res.json(await service.listStops(uuidParam(req, "routeId"), tenantId(req)));
});
transportRouter.post("/routes/:routeId/stops", canCreate, async (req, res) => {
  res.status(201).json(await service.createStop(uuidParam(req, "routeId"), createStopSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/stops/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update a stop
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Transport]
 *     summary: Delete a stop
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.patch("/stops/:id", canUpdate, async (req, res) => {
  res.json(await service.updateStop(uuidParam(req), updateStopSchema.parse(req.body), tenantId(req)));
});
transportRouter.delete("/stops/:id", canDelete, async (req, res) => {
  await service.deleteStop(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/allocations:
 *   get:
 *     tags: [Transport]
 *     summary: List student transport allocations (filter by route/stop)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: routeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: stopId, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: Allocations } }
 *   post:
 *     tags: [Transport]
 *     summary: Allocate a student to a route/stop
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, routeId]
 *             properties:
 *               studentId: { type: string, format: uuid }
 *               routeId: { type: string, format: uuid }
 *               stopId: { type: string, format: uuid, nullable: true }
 *               tripType: { type: string, enum: [pickup, drop, both] }
 *               effectiveDate: { type: string, format: date }
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       201: { description: Created allocation }
 *       409: { description: Student already allocated }
 */
transportRouter.get("/allocations", canRead, async (req, res) => {
  res.json(
    await service.listAllocations(tenantId(req), {
      routeId: optStr(req.query.routeId),
      stopId: optStr(req.query.stopId),
    })
  );
});
transportRouter.post("/allocations", canAllocate, async (req, res) => {
  res.status(201).json(await service.createAllocation(createAllocationSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/allocations/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update an allocation (route/stop/status)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Transport]
 *     summary: Remove an allocation
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.patch("/allocations/:id", canAllocate, async (req, res) => {
  res.json(await service.updateAllocation(uuidParam(req), updateAllocationSchema.parse(req.body), tenantId(req)));
});
transportRouter.delete("/allocations/:id", canAllocate, async (req, res) => {
  await service.deleteAllocation(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/fees:
 *   get:
 *     tags: [Transport]
 *     summary: List transport fees (route/stop level)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: routeId, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Fees } }
 *   post:
 *     tags: [Transport]
 *     summary: Set a route- or stop-level transport fee (upsert)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [routeId, amount]
 *             properties:
 *               routeId: { type: string, format: uuid }
 *               stopId: { type: string, format: uuid, nullable: true }
 *               amount: { type: number }
 *               frequency: { type: string, enum: [monthly, term, annual] }
 *     responses: { 200: { description: Fee saved } }
 */
transportRouter.get("/fees", canRead, async (req, res) => {
  res.json(await service.listFees(tenantId(req), optStr(req.query.routeId)));
});
transportRouter.post("/fees", canFees, async (req, res) => {
  res.json(await service.setFee(setFeeSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/fees/{id}:
 *   delete:
 *     tags: [Transport]
 *     summary: Delete a transport fee mapping
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 204: { description: Deleted } }
 */
transportRouter.delete("/fees/:id", canFees, async (req, res) => {
  await service.deleteFee(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /transport/fees/generate:
 *   post:
 *     tags: [Transport]
 *     summary: Generate transport-fee invoices for active allocations (idempotent per student+period)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dueDate, period]
 *             properties:
 *               routeId: { type: string, format: uuid, description: "limit to one route" }
 *               dueDate: { type: string, format: date }
 *               period: { type: string, example: "2026-07" }
 *               description: { type: string }
 *     responses:
 *       200: { description: "{ generated, skipped }" }
 */
transportRouter.post("/fees/generate", canFees, async (req, res) => {
  res.json(await service.generateInvoices(generateInvoicesSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/trips:
 *   get:
 *     tags: [Transport]
 *     summary: List trips (filter by route/date)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: routeId, schema: { type: string, format: uuid } }
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *     responses: { 200: { description: Trips } }
 *   post:
 *     tags: [Transport]
 *     summary: Schedule a trip (one pickup + one drop per route/day)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [routeId, tripDate, tripType]
 *             properties:
 *               routeId: { type: string, format: uuid }
 *               tripDate: { type: string, format: date }
 *               tripType: { type: string, enum: [pickup, drop] }
 *               vehicleId: { type: string, format: uuid, nullable: true }
 *               driverId: { type: string, format: uuid, nullable: true }
 *               status: { type: string, enum: [scheduled, completed, cancelled] }
 *     responses:
 *       201: { description: Created trip }
 *       409: { description: Trip already exists for that route/date/type }
 */
transportRouter.get("/trips", canRead, async (req, res) => {
  res.json(
    await service.listTrips(tenantId(req), {
      routeId: optStr(req.query.routeId),
      date: optStr(req.query.date),
    })
  );
});
transportRouter.post("/trips", canUpdate, async (req, res) => {
  res.status(201).json(await service.createTrip(createTripSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/trips/{id}:
 *   patch:
 *     tags: [Transport]
 *     summary: Update a trip (status / vehicle / driver)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 */
transportRouter.patch("/trips/:id", canUpdate, async (req, res) => {
  res.json(await service.updateTrip(uuidParam(req), updateTripSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transport/students/{studentId}/allocation:
 *   get:
 *     tags: [Transport]
 *     summary: A student's own transport details (owner-scoped, for the portal)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: studentId, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "Allocation detail (route/stop/timings/vehicle/driver) or null" }
 *       403: { description: Not the student's own record }
 */
transportRouter.get("/students/:studentId/allocation", async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await service.studentAllocation(studentId, tenantId(req)));
});
