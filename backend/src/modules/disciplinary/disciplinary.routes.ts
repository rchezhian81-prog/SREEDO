import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import {
  actionDisciplinarySchema,
  cancelDisciplinarySchema,
  createDisciplinarySchema,
  listDisciplinaryQuerySchema,
  noteSchema,
  portalSettingsSchema,
  updateDisciplinarySchema,
} from "./disciplinary.schema";
import * as service from "./disciplinary.service";

export const disciplinaryRouter = Router();
disciplinaryRouter.use(authenticate, requireTenant);

const canRead = requirePermission("disciplinary:read");
const canCreate = requirePermission("disciplinary:create");
const canUpdate = requirePermission("disciplinary:update");
const canAction = requirePermission("disciplinary:action");
const canClose = requirePermission("disciplinary:close");
const canDelete = requirePermission("disciplinary:delete");

/**
 * @openapi
 * /disciplinary:
 *   get: { tags: [Disciplinary], summary: Disciplinary register (filterable), security: [{ bearerAuth: [] }], parameters: [{ in: query, name: status, schema: { type: string } }, { in: query, name: severity, schema: { type: string } }, { in: query, name: studentId, schema: { type: string, format: uuid } }, { in: query, name: dateFrom, schema: { type: string } }, { in: query, name: dateTo, schema: { type: string } }, { in: query, name: search, schema: { type: string } }], responses: { 200: { description: Records } } }
 *   post: { tags: [Disciplinary], summary: Log a disciplinary incident (snapshots the student), security: [{ bearerAuth: [] }], responses: { 201: { description: Created } } }
 */
disciplinaryRouter.get("/", canRead, async (req, res) => {
  const filters = listDisciplinaryQuerySchema.parse(req.query);
  res.json(await service.listRecords(tenantId(req), filters, await accessibleStudentIds(req)));
});
disciplinaryRouter.post("/", canCreate, async (req, res) => {
  const input = createDisciplinarySchema.parse(req.body);
  res.status(201).json(await service.createRecord(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /disciplinary/settings:
 *   get: { tags: [Disciplinary], summary: Portal-visibility setting, security: [{ bearerAuth: [] }], responses: { 200: { description: "{ portalEnabled }" } } }
 *   patch: { tags: [Disciplinary], summary: Enable/disable portal visibility (OFF by default), security: [{ bearerAuth: [] }], responses: { 200: { description: Updated } } }
 */
disciplinaryRouter.get("/settings", canRead, async (req, res) => {
  res.json(await service.getPortalSettings(tenantId(req)));
});
disciplinaryRouter.patch("/settings", canUpdate, async (req, res) => {
  const { portalEnabled } = portalSettingsSchema.parse(req.body);
  res.json(await service.setPortalSettings(tenantId(req), portalEnabled));
});

/**
 * @openapi
 * /disciplinary/student/{studentId}:
 *   get: { tags: [Disciplinary], summary: A student's disciplinary history, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: studentId, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: History } } }
 */
disciplinaryRouter.get("/student/:studentId", canRead, async (req, res) => {
  const studentId = uuidParam(req, "studentId");
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  res.json(await service.studentHistory(studentId, tenantId(req)));
});

/**
 * @openapi
 * /disciplinary/{id}:
 *   get: { tags: [Disciplinary], summary: Disciplinary record detail, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Record }, 404: { description: Not found } } }
 *   patch: { tags: [Disciplinary], summary: Edit a record (open records only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 *   delete: { tags: [Disciplinary], summary: Delete a record (entered wrongly), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 204: { description: Deleted } } }
 */
disciplinaryRouter.get("/:id", canRead, async (req, res) => {
  const rec = await service.getRecord(uuidParam(req), tenantId(req));
  assertStudentAccess(await accessibleStudentIds(req), rec.studentId);
  res.json(rec);
});
disciplinaryRouter.patch("/:id", canUpdate, async (req, res) => {
  const input = updateDisciplinarySchema.parse(req.body);
  res.json(await service.updateRecord(uuidParam(req), input, tenantId(req), req.user!.id));
});
disciplinaryRouter.delete("/:id", canDelete, async (req, res) => {
  await service.deleteRecord(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /disciplinary/{id}/actions:
 *   get: { tags: [Disciplinary], summary: Audit timeline for a record, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Timeline } } }
 */
disciplinaryRouter.get("/:id/actions", canRead, async (req, res) => {
  res.json(await service.listActions(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /disciplinary/{id}/review:
 *   post: { tags: [Disciplinary], summary: Mark a record under review, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
disciplinaryRouter.post("/:id/review", canAction, async (req, res) => {
  const { note } = noteSchema.parse(req.body ?? {});
  res.json(await service.markReview(uuidParam(req), note ?? null, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /disciplinary/{id}/action:
 *   post: { tags: [Disciplinary], summary: Record the action taken (moves to action_taken), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated } } }
 */
disciplinaryRouter.post("/:id/action", canAction, async (req, res) => {
  const input = actionDisciplinarySchema.parse(req.body);
  res.json(await service.recordAction(uuidParam(req), input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /disciplinary/{id}/close:
 *   post: { tags: [Disciplinary], summary: Close a record, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Closed } } }
 */
disciplinaryRouter.post("/:id/close", canClose, async (req, res) => {
  const { note } = noteSchema.parse(req.body ?? {});
  res.json(await service.closeRecord(uuidParam(req), note ?? null, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /disciplinary/{id}/cancel:
 *   post: { tags: [Disciplinary], summary: Cancel a record (entered wrongly; retained for audit), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Cancelled } } }
 */
disciplinaryRouter.post("/:id/cancel", canDelete, async (req, res) => {
  const input = cancelDisciplinarySchema.parse(req.body ?? {});
  res.json(await service.cancelRecord(uuidParam(req), input, tenantId(req), req.user!.id));
});
