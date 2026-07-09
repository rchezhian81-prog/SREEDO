import { Router, type Request } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import { recordAudit } from "../observability/audit";
import {
  createFeedbackSchema,
  updateFeedbackSchema,
  listFeedbackQuerySchema,
  publicFeedbackSchema,
} from "./feedback.schema";
import * as service from "./feedback.service";

export const feedbackRouter = Router();

/**
 * @openapi
 * /feedback/submit:
 *   post:
 *     tags: [Feedback]
 *     summary: Public feedback / grievance submission (no auth), by school code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [institutionCode, subject, message]
 *             properties:
 *               institutionCode: { type: string }
 *               type: { type: string, enum: [feedback, complaint, suggestion, grievance, enquiry] }
 *               subject: { type: string }
 *               message: { type: string }
 *               submitterName: { type: string }
 *               submitterContact: { type: string }
 *     responses:
 *       201: { description: "Submitted { id, status }" }
 *       404: { description: No school for that code }
 */
feedbackRouter.post("/submit", async (req, res) => {
  const input = publicFeedbackSchema.parse(req.body);
  res.status(201).json(await service.createPublicFeedback(input));
});

// PR-T7 — the enquiries/complaints surface is part of the unified front office,
// so it is now gated by the shared front_office:* permission namespace (read for
// reads, manage for writes) instead of the coarse authorize("admin"). admin
// retains access (0107 grants admin front_office:read/manage); the jr_front_office
// / jr_admin_officer job-roles can now be delegated here too. Tenant-scoped.
feedbackRouter.use(authenticate, requireTenant);

const actorOf = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

/**
 * @openapi
 * /feedback:
 *   get:
 *     tags: [Feedback]
 *     summary: List feedback / grievances (filter by type/status, search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: type, schema: { type: string, enum: [feedback, complaint, suggestion, grievance, enquiry] } }
 *       - { in: query, name: status, schema: { type: string, enum: [open, in_progress, resolved, closed] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated entries }
 *   post:
 *     tags: [Feedback]
 *     summary: Log a feedback / grievance / enquiry entry (front office)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               type: { type: string, enum: [feedback, complaint, suggestion, grievance, enquiry] }
 *               subject: { type: string }
 *               message: { type: string }
 *               submitterName: { type: string }
 *               submitterContact: { type: string }
 *     responses:
 *       201: { description: Created entry }
 */
feedbackRouter.get("/", requirePermission("front_office:read"), async (req, res) => {
  const params = listFeedbackQuerySchema.parse(req.query);
  res.json(await service.listFeedback(parsePagination(params), params, tenantId(req)));
});

feedbackRouter.post("/", requirePermission("front_office:manage"), async (req, res) => {
  const input = createFeedbackSchema.parse(req.body);
  res.status(201).json(await service.createFeedback(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /feedback/{id}:
 *   get:
 *     tags: [Feedback]
 *     summary: Get one entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Entry }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Feedback]
 *     summary: Update an entry (status / resolution / fields)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated entry }
 *   delete:
 *     tags: [Feedback]
 *     summary: Delete an entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
feedbackRouter.get("/:id", requirePermission("front_office:read"), async (req, res) => {
  res.json(await service.getFeedback(uuidParam(req), tenantId(req)));
});

feedbackRouter.patch("/:id", requirePermission("front_office:manage"), async (req, res) => {
  const input = updateFeedbackSchema.parse(req.body);
  const id = uuidParam(req);
  const updated = await service.updateFeedback(id, input, tenantId(req));
  // Complaint/grievance handling is accountable — audit status/resolution changes.
  await recordAudit(actorOf(req), {
    action: "frontoffice.complaint.update",
    targetType: "feedback",
    targetId: id,
    institutionId: tenantId(req),
    detail: { fields: Object.keys(input), status: input.status },
  });
  res.json(updated);
});

feedbackRouter.delete("/:id", requirePermission("front_office:manage"), async (req, res) => {
  const id = uuidParam(req);
  await service.deleteFeedback(id, tenantId(req));
  await recordAudit(actorOf(req), {
    action: "frontoffice.complaint.delete",
    targetType: "feedback",
    targetId: id,
    institutionId: tenantId(req),
    detail: {},
  });
  res.status(204).end();
});
