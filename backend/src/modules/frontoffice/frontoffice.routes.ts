import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createDispatchSchema,
  updateDispatchSchema,
  listDispatchQuerySchema,
  createCallSchema,
  updateCallSchema,
  listCallQuerySchema,
} from "./frontoffice.schema";
import * as service from "./frontoffice.service";

// PR-T7 — Front-office hub: the NEW postal/dispatch + call registers, plus a
// cross-surface summary. Reuses the existing front_office:* permission namespace
// (read for reads, manage for writes) so the whole hub — visitors, complaints,
// lost & found, postal, calls — is gated by one capability. Tenant-scoped.
export const frontOfficeRouter = Router();
frontOfficeRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /front-office/summary:
 *   get:
 *     tags: [Front Office]
 *     summary: Front-office at-a-glance counts (visitors inside, open complaints/lost-found, today's dispatches/calls, follow-ups due)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Summary counts }
 */
frontOfficeRouter.get("/summary", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.frontOfficeSummary(tenantId(req)));
});

// --- Postal / Dispatch register ---------------------------------------------

/**
 * @openapi
 * /front-office/postal:
 *   get:
 *     tags: [Front Office]
 *     summary: List postal / dispatch entries (filter by direction/status/search/date)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: direction, schema: { type: string, enum: [inbound, outbound] } }
 *       - { in: query, name: status, schema: { type: string, enum: [received, dispatched, delivered, collected] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated dispatch entries }
 *   post:
 *     tags: [Front Office]
 *     summary: Log an inbound or outbound postal / courier item
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [direction, partyName]
 *             properties:
 *               direction: { type: string, enum: [inbound, outbound] }
 *               itemType: { type: string, enum: [letter, parcel, courier, speed_post, other] }
 *               refNo: { type: string }
 *               partyName: { type: string }
 *               addressee: { type: string }
 *               carrier: { type: string }
 *               trackingNo: { type: string }
 *               itemDate: { type: string, format: date }
 *               status: { type: string, enum: [received, dispatched, delivered, collected] }
 *               remarks: { type: string }
 *               handledBy: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created dispatch entry }
 */
frontOfficeRouter.get("/postal", requirePermission("front_office:read"), async (req, res) => {
  const params = listDispatchQuerySchema.parse(req.query);
  res.json(await service.listDispatches(parsePagination(params), params, tenantId(req)));
});

frontOfficeRouter.post("/postal", requirePermission("front_office:manage"), async (req, res) => {
  const input = createDispatchSchema.parse(req.body);
  const created = await service.createDispatch(input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "frontoffice.dispatch.create",
    targetType: "postal_dispatch",
    targetId: created.id,
    institutionId: tenantId(req),
    detail: { direction: created.direction, itemType: created.itemType, refNo: created.refNo ?? undefined },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /front-office/postal/{id}:
 *   get:
 *     tags: [Front Office]
 *     summary: Get one dispatch entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Dispatch entry }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Front Office]
 *     summary: Update a dispatch entry (status / details)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *   delete:
 *     tags: [Front Office]
 *     summary: Delete a dispatch entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
frontOfficeRouter.get("/postal/:id", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.getDispatch(uuidParam(req), tenantId(req)));
});

frontOfficeRouter.patch("/postal/:id", requirePermission("front_office:manage"), async (req, res) => {
  const input = updateDispatchSchema.parse(req.body);
  const id = uuidParam(req);
  const updated = await service.updateDispatch(id, input, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "frontoffice.dispatch.update",
    targetType: "postal_dispatch",
    targetId: id,
    institutionId: tenantId(req),
    detail: { fields: Object.keys(input) },
  });
  res.json(updated);
});

frontOfficeRouter.delete("/postal/:id", requirePermission("front_office:manage"), async (req, res) => {
  const id = uuidParam(req);
  await service.deleteDispatch(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "frontoffice.dispatch.delete",
    targetType: "postal_dispatch",
    targetId: id,
    institutionId: tenantId(req),
    detail: {},
  });
  res.status(204).end();
});

// --- Call register -----------------------------------------------------------

/**
 * @openapi
 * /front-office/calls:
 *   get:
 *     tags: [Front Office]
 *     summary: List call-register entries (filter by direction/relatedTo/search/date)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: direction, schema: { type: string, enum: [incoming, outgoing] } }
 *       - { in: query, name: relatedTo, schema: { type: string, enum: [general, admission, enquiry, complaint, fees, transport, other] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated call entries }
 *   post:
 *     tags: [Front Office]
 *     summary: Log an incoming or outgoing call
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [direction, callerName]
 *             properties:
 *               direction: { type: string, enum: [incoming, outgoing] }
 *               callerName: { type: string }
 *               phone: { type: string }
 *               purpose: { type: string }
 *               relatedTo: { type: string, enum: [general, admission, enquiry, complaint, fees, transport, other] }
 *               followUpDate: { type: string, format: date }
 *               notes: { type: string }
 *               handledBy: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created call entry }
 */
frontOfficeRouter.get("/calls", requirePermission("front_office:read"), async (req, res) => {
  const params = listCallQuerySchema.parse(req.query);
  res.json(await service.listCalls(parsePagination(params), params, tenantId(req)));
});

frontOfficeRouter.post("/calls", requirePermission("front_office:manage"), async (req, res) => {
  const input = createCallSchema.parse(req.body);
  const created = await service.createCall(input, tenantId(req), req.user!.id);
  await recordAudit(actorOf(req), {
    action: "frontoffice.call.create",
    targetType: "call_log",
    targetId: created.id,
    institutionId: tenantId(req),
    detail: { direction: created.direction, relatedTo: created.relatedTo },
  });
  res.status(201).json(created);
});

/**
 * @openapi
 * /front-office/calls/{id}:
 *   get:
 *     tags: [Front Office]
 *     summary: Get one call entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Call entry }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Front Office]
 *     summary: Update a call entry (follow-up / details)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *   delete:
 *     tags: [Front Office]
 *     summary: Delete a call entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
frontOfficeRouter.get("/calls/:id", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.getCall(uuidParam(req), tenantId(req)));
});

frontOfficeRouter.patch("/calls/:id", requirePermission("front_office:manage"), async (req, res) => {
  const input = updateCallSchema.parse(req.body);
  res.json(await service.updateCall(uuidParam(req), input, tenantId(req)));
});

frontOfficeRouter.delete("/calls/:id", requirePermission("front_office:manage"), async (req, res) => {
  const id = uuidParam(req);
  await service.deleteCall(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "frontoffice.call.delete",
    targetType: "call_log",
    targetId: id,
    institutionId: tenantId(req),
    detail: {},
  });
  res.status(204).end();
});
