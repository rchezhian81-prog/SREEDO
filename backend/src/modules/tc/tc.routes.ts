import type { Request, Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { permissionsForRole, requirePermission } from "../../middleware/permissions";
import { accessibleStudentIds, assertStudentAccess, isStaff } from "../../utils/scope";
import {
  cancelTcSchema,
  createTcSchema,
  issueTcSchema,
  listTcQuerySchema,
  updateTcSchema,
} from "./tc.schema";
import * as service from "./tc.service";

export const transferCertificatesRouter = Router();
transferCertificatesRouter.use(authenticate, requireTenant);

async function hasPermission(req: Request, key: string): Promise<boolean> {
  if (req.user!.role === "super_admin") return true;
  return (await permissionsForRole(req.user!.role)).includes(key);
}

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res
    .type("application/pdf")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(buffer);
}

/**
 * @openapi
 * /transfer-certificates:
 *   get:
 *     tags: [Transfer Certificates]
 *     summary: TC register (owner-scoped for student/parent)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, issued, cancelled] } }
 *       - { in: query, name: studentId, schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses: { 200: { description: TC list } }
 *   post:
 *     tags: [Transfer Certificates]
 *     summary: Create a TC draft (snapshots student + assigns a TC number)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created draft } }
 */
transferCertificatesRouter.get("/", requirePermission("transfer_certificates:read"), async (req, res) => {
  const filters = listTcQuerySchema.parse(req.query);
  res.json(await service.listTcs(tenantId(req), filters, await accessibleStudentIds(req)));
});

transferCertificatesRouter.post("/", requirePermission("transfer_certificates:create"), async (req, res) => {
  const input = createTcSchema.parse(req.body);
  res.status(201).json(await service.createTc(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /transfer-certificates/student/{studentId}/dues:
 *   get:
 *     tags: [Transfer Certificates]
 *     summary: Pending dues (fees, library, transport, hostel) for a student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses: { 200: { description: "{ fee, library, transport, hostel, hasDues }" } }
 */
transferCertificatesRouter.get(
  "/student/:studentId/dues",
  requirePermission("transfer_certificates:read"),
  async (req, res) => {
    const studentId = uuidParam(req, "studentId");
    assertStudentAccess(await accessibleStudentIds(req), studentId);
    res.json(await service.studentDues(studentId, tenantId(req)));
  }
);

/**
 * @openapi
 * /transfer-certificates/{id}:
 *   get:
 *     tags: [Transfer Certificates]
 *     summary: TC detail (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: TC }, 403: { description: Not accessible }, 404: { description: Not found } }
 *   patch:
 *     tags: [Transfer Certificates]
 *     summary: Edit a TC draft
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated } }
 */
transferCertificatesRouter.get("/:id", requirePermission("transfer_certificates:read"), async (req, res) => {
  const tc = await service.getTc(uuidParam(req), tenantId(req));
  assertStudentAccess(await accessibleStudentIds(req), tc.studentId);
  res.json(tc);
});

transferCertificatesRouter.patch("/:id", requirePermission("transfer_certificates:update"), async (req, res) => {
  res.json(await service.updateTc(uuidParam(req), updateTcSchema.parse(req.body), tenantId(req)));
});

/**
 * @openapi
 * /transfer-certificates/{id}/issue:
 *   post:
 *     tags: [Transfer Certificates]
 *     summary: Issue a TC (blocked by pending dues unless overridden)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Issued TC }
 *       400: { description: Pending dues / not a draft }
 *       403: { description: Lacks dues-override permission }
 */
transferCertificatesRouter.post("/:id/issue", requirePermission("transfer_certificates:issue"), async (req, res) => {
  const input = issueTcSchema.parse(req.body ?? {});
  const canOverride = await hasPermission(req, "transfer_certificates:override_dues");
  res.json(await service.issueTc(uuidParam(req), input, req.user!.id, tenantId(req), canOverride));
});

/**
 * @openapi
 * /transfer-certificates/{id}/cancel:
 *   post:
 *     tags: [Transfer Certificates]
 *     summary: Cancel a TC (remains in the register, invalid)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Cancelled TC } }
 */
transferCertificatesRouter.post("/:id/cancel", requirePermission("transfer_certificates:cancel"), async (req, res) => {
  res.json(await service.cancelTc(uuidParam(req), cancelTcSchema.parse(req.body ?? {}), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /transfer-certificates/{id}/download:
 *   get:
 *     tags: [Transfer Certificates]
 *     summary: Download the TC PDF (owner-scoped; student/parent only when issued)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: PDF }
 *       403: { description: Not accessible / not yet issued }
 */
transferCertificatesRouter.get("/:id/download", requirePermission("transfer_certificates:download"), async (req, res) => {
  const id = uuidParam(req);
  const tc = await service.getTc(id, tenantId(req));
  assertStudentAccess(await accessibleStudentIds(req), tc.studentId);
  // Non-staff (student/parent) may only download an issued certificate.
  if (!isStaff(req.user!.role) && tc.status !== "issued") {
    res.status(403).json({ error: "This certificate is not available for download yet" });
    return;
  }
  const buf = await service.tcBuffer(id, tenantId(req));
  sendPdf(res, buf, `${tc.tcNo}.pdf`);
});
