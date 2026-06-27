import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createAlbumSchema,
  updateAlbumSchema,
  listAlbumsQuerySchema,
  addPhotoSchema,
} from "./gallery.schema";
import * as service from "./gallery.service";

// Photo gallery management — institution-admin only, tenant-scoped.
// (Students & parents view published albums through the portal router.)
export const galleryRouter = Router();
galleryRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /gallery/albums:
 *   get:
 *     tags: [Gallery]
 *     summary: List albums (search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated albums }
 *   post:
 *     tags: [Gallery]
 *     summary: Create an album
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               coverUrl: { type: string, format: uri }
 *     responses:
 *       201: { description: Created album }
 */
galleryRouter.get("/albums", async (req, res) => {
  const params = listAlbumsQuerySchema.parse(req.query);
  res.json(await service.listAlbums(parsePagination(params), params, tenantId(req)));
});

galleryRouter.post("/albums", async (req, res) => {
  const input = createAlbumSchema.parse(req.body);
  res.status(201).json(await service.createAlbum(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /gallery/albums/{id}:
 *   get:
 *     tags: [Gallery]
 *     summary: Get an album with its photos
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Album with photos }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Gallery]
 *     summary: Update an album (title / description / cover / publish)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated album }
 *   delete:
 *     tags: [Gallery]
 *     summary: Delete an album (and its photos)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
galleryRouter.get("/albums/:id", async (req, res) => {
  res.json(await service.getAlbum(uuidParam(req), tenantId(req)));
});

galleryRouter.patch("/albums/:id", async (req, res) => {
  const input = updateAlbumSchema.parse(req.body);
  res.json(await service.updateAlbum(uuidParam(req), input, tenantId(req)));
});

galleryRouter.delete("/albums/:id", async (req, res) => {
  await service.deleteAlbum(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /gallery/albums/{id}/photos:
 *   post:
 *     tags: [Gallery]
 *     summary: Add a photo (image URL) to an album
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imageUrl]
 *             properties:
 *               imageUrl: { type: string, format: uri }
 *               caption: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Album with the new photo }
 */
galleryRouter.post("/albums/:id/photos", async (req, res) => {
  const input = addPhotoSchema.parse(req.body);
  res.status(201).json(await service.addPhoto(uuidParam(req), input, tenantId(req)));
});

/**
 * @openapi
 * /gallery/photos/{photoId}:
 *   delete:
 *     tags: [Gallery]
 *     summary: Delete a photo
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: photoId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
galleryRouter.delete("/photos/:photoId", async (req, res) => {
  await service.deletePhoto(uuidParam(req, "photoId"), tenantId(req));
  res.status(204).end();
});
