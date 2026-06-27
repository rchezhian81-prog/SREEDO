import type { Response } from "express";
import { Router } from "express";
import { param, uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import * as service from "./pdfs.service";

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res
    .type("application/pdf")
    .set("Content-Disposition", `inline; filename="${filename}"`)
    .send(buffer);
}

export const feeReceiptsRouter = Router();
feeReceiptsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /fee-receipts/{paymentId}/download:
 *   get:
 *     tags: [PDFs]
 *     summary: Download a fee-payment receipt PDF (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: paymentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF, content: { application/pdf: {} } }
 *       403: { description: Not an accessible student }
 *       404: { description: Payment not found }
 */
feeReceiptsRouter.get(
  "/:paymentId/download",
  requirePermission("fee_receipts:download"),
  async (req, res) => {
    const buf = await service.feeReceiptBuffer(req, uuidParam(req, "paymentId"), tenantId(req));
    sendPdf(res, buf, "fee-receipt.pdf");
  }
);

export const idCardsRouter = Router();
idCardsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /id-cards/student/{studentId}/download:
 *   get:
 *     tags: [PDFs]
 *     summary: Download a student ID card PDF (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF }
 *       403: { description: Not an accessible student }
 *       404: { description: Student not found }
 */
idCardsRouter.get(
  "/student/:studentId/download",
  requirePermission("id_cards:download"),
  async (req, res) => {
    const buf = await service.studentIdCardBuffer(req, uuidParam(req, "studentId"), tenantId(req));
    sendPdf(res, buf, "student-id-card.pdf");
  }
);

/**
 * @openapi
 * /id-cards/staff/{userId}/download:
 *   get:
 *     tags: [PDFs]
 *     summary: Download a staff ID card PDF (own, or any for admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: PDF }
 *       403: { description: Not permitted }
 *       404: { description: Staff not found }
 */
idCardsRouter.get(
  "/staff/:userId/download",
  requirePermission("id_cards:download"),
  async (req, res) => {
    const buf = await service.staffIdCardBuffer(req, uuidParam(req, "userId"), tenantId(req));
    sendPdf(res, buf, "staff-id-card.pdf");
  }
);

/**
 * @openapi
 * /id-cards/section/{sectionId}/bulk:
 *   get:
 *     tags: [PDFs]
 *     summary: Download a section's student ID cards as one PDF (staff)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: sectionId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Multi-card PDF }
 *       404: { description: Section not found }
 */
idCardsRouter.get(
  "/section/:sectionId/bulk",
  requirePermission("id_cards:generate"),
  async (req, res) => {
    const buf = await service.bulkStudentIdCardsBuffer(uuidParam(req, "sectionId"), tenantId(req));
    sendPdf(res, buf, "section-id-cards.pdf");
  }
);

export const certificatesRouter = Router();
certificatesRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /certificates/student/{studentId}/{type}/download:
 *   get:
 *     tags: [PDFs]
 *     summary: Download a student certificate PDF (bonafide / conduct / character) — staff
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [bonafide, conduct, character] } }
 *       - { in: query, name: purpose, schema: { type: string }, description: "Optional purpose line (e.g. bank account opening)" }
 *     responses:
 *       200: { description: PDF, content: { application/pdf: {} } }
 *       400: { description: Unknown certificate type }
 *       403: { description: Staff only }
 *       404: { description: Student not found }
 */
certificatesRouter.get(
  "/student/:studentId/:type/download",
  authorize("admin", "teacher"),
  async (req, res) => {
    const type = param(req, "type");
    if (!service.CERTIFICATE_TYPES.includes(type)) {
      throw ApiError.badRequest("Unknown certificate type");
    }
    const purpose =
      typeof req.query.purpose === "string" && req.query.purpose.trim()
        ? req.query.purpose.trim().slice(0, 200)
        : undefined;
    const buf = await service.certificateBuffer(
      type,
      uuidParam(req, "studentId"),
      tenantId(req),
      { purpose }
    );
    sendPdf(res, buf, `${type}-certificate.pdf`);
  }
);
