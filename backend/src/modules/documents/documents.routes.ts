import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { ApiError } from "../../utils/api-error";
import { listQuerySchema, uploadFieldsSchema } from "./documents.schema";
import * as service from "./documents.service";

export const documentsRouter = Router();

documentsRouter.use(authenticate, requireTenant);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.storageMaxMb * 1024 * 1024, files: 1 },
});

/** Runs multer and maps its errors (e.g. size limit) to ApiError. */
function single(field: string) {
  const mw = upload.single(field);
  return (req: Request, res: Response, next: NextFunction) =>
    mw(req, res, (err: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code;
        if (code === "LIMIT_FILE_SIZE") {
          return next(ApiError.badRequest("File exceeds the size limit"));
        }
        return next(ApiError.badRequest(`Upload failed: ${(err as Error).message}`));
      }
      next();
    });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

/**
 * @openapi
 * /documents:
 *   get:
 *     tags: [Documents]
 *     summary: List document metadata (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: ownerType, schema: { type: string } }
 *       - { in: query, name: ownerId, schema: { type: string, format: uuid } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses:
 *       200: { description: Documents (no storage paths exposed) }
 *   post:
 *     tags: [Documents]
 *     summary: Upload a document (multipart/form-data, field "file")
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, ownerType]
 *             properties:
 *               file: { type: string, format: binary }
 *               ownerType: { type: string, enum: [student, user, institution, message] }
 *               ownerId: { type: string, format: uuid }
 *               category: { type: string, enum: [profile_photo, id_card, certificate, tc, document, logo, attachment] }
 *     responses:
 *       201: { description: Document metadata }
 *       400: { description: Invalid/oversized/unsupported file }
 */
documentsRouter.get(
  "/",
  requirePermission("documents:read"),
  async (req, res) => {
    const filters = listQuerySchema.parse(req.query);
    res.json(await service.listDocuments(req, filters, tenantId(req)));
  }
);

documentsRouter.post(
  "/",
  requirePermission("documents:upload"),
  single("file"),
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest("A file is required");
    const fields = uploadFieldsSchema.parse(req.body);
    res.status(201).json(await service.createDocument(req, fields, req.file, tenantId(req)));
  }
);

/**
 * @openapi
 * /documents/logo:
 *   post:
 *     tags: [Documents]
 *     summary: Upload/replace the institution logo (image)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201: { description: Logo document metadata }
 */
documentsRouter.post(
  "/logo",
  requirePermission("institution:logo:update"),
  single("file"),
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest("A file is required");
    res.status(201).json(await service.setInstitutionLogo(req, req.file, tenantId(req)));
  }
);

/**
 * @openapi
 * /documents/{id}/download:
 *   get:
 *     tags: [Documents]
 *     summary: Download a document through a protected, owner-scoped route
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The file bytes }
 *       403: { description: Not permitted }
 *       404: { description: Not found }
 */
documentsRouter.get(
  "/:id/download",
  requirePermission("documents:download"),
  async (req, res) => {
    const { buffer, mimeType, originalName } = await service.downloadDocument(
      req,
      uuidParam(req),
      tenantId(req)
    );
    res
      .type(mimeType)
      .set(
        "Content-Disposition",
        `inline; filename="${sanitizeFilename(originalName)}"`
      )
      .send(buffer);
  }
);

/**
 * @openapi
 * /documents/{id}:
 *   delete:
 *     tags: [Documents]
 *     summary: Delete a document (and its stored file)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
documentsRouter.delete(
  "/:id",
  requirePermission("documents:delete"),
  async (req, res) => {
    await service.deleteDocument(uuidParam(req), tenantId(req));
    res.status(204).end();
  }
);
