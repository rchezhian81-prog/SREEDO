import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { ApiError } from "../../utils/api-error";
import { parsePagination } from "../../utils/pagination";
import {
  createDeviceSchema,
  updateDeviceSchema,
  listEventsQuerySchema,
  ingestSchema,
} from "./biometric.schema";
import * as service from "./biometric.service";

export const biometricRouter = Router();

/**
 * @openapi
 * /biometric/ingest:
 *   post:
 *     tags: [Biometric]
 *     summary: Push a scan event from a device (auth via x-device-key header)
 *     parameters:
 *       - { in: header, name: x-device-key, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier]
 *             properties:
 *               identifier: { type: string, description: "Scanned ID (student admission no)" }
 *               eventType: { type: string, enum: [in, out] }
 *               eventTime: { type: string, format: date-time }
 *     responses:
 *       201: { description: "{ recorded, matched, attendanceMarked }" }
 *       401: { description: Invalid or inactive device key }
 */
biometricRouter.post("/ingest", async (req, res) => {
  const deviceKey = req.header("x-device-key");
  if (!deviceKey) throw ApiError.unauthorized("Missing device key");
  const input = ingestSchema.parse(req.body);
  res.status(201).json(await service.ingest(deviceKey, input));
});

// Everything below is institution-admin only, tenant-scoped.
biometricRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /biometric/devices:
 *   get:
 *     tags: [Biometric]
 *     summary: List registered devices
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Devices }
 *   post:
 *     tags: [Biometric]
 *     summary: Register a device (returns a generated device key)
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
 *               location: { type: string }
 *     responses:
 *       201: { description: Created device with device key }
 */
biometricRouter.get("/devices", async (req, res) => {
  res.json(await service.listDevices(tenantId(req)));
});

biometricRouter.post("/devices", async (req, res) => {
  const input = createDeviceSchema.parse(req.body);
  res.status(201).json(await service.createDevice(input, tenantId(req)));
});

/**
 * @openapi
 * /biometric/devices/{id}:
 *   patch:
 *     tags: [Biometric]
 *     summary: Update a device (name / location / active)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated device }
 *   delete:
 *     tags: [Biometric]
 *     summary: Delete a device
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
biometricRouter.patch("/devices/:id", async (req, res) => {
  const input = updateDeviceSchema.parse(req.body);
  res.json(await service.updateDevice(uuidParam(req), input, tenantId(req)));
});

biometricRouter.delete("/devices/:id", async (req, res) => {
  await service.deleteDevice(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /biometric/events:
 *   get:
 *     tags: [Biometric]
 *     summary: List scan events (filter by device / date range)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: deviceId, schema: { type: string, format: uuid } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated events }
 */
biometricRouter.get("/events", async (req, res) => {
  const params = listEventsQuerySchema.parse(req.query);
  res.json(await service.listEvents(parsePagination(params), params, tenantId(req)));
});
