import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createMaterialSchema,
  updateMaterialSchema,
  listMaterialsQuerySchema,
} from "./studymaterials.schema";
import * as service from "./studymaterials.service";

// Study materials (LMS) — created/managed by admins & teachers, tenant-scoped.
// (Students & parents read their class's materials through the portal router.)
export const studyMaterialsRouter = Router();
studyMaterialsRouter.use(authenticate, requireTenant, authorize("admin", "teacher"));

/**
 * @openapi
 * /study-materials:
 *   get:
 *     tags: [Study Materials]
 *     summary: List study materials (filter by class / subject, search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: classId, schema: { type: string, format: uuid } }
 *       - { in: query, name: subjectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated study materials }
 *   post:
 *     tags: [Study Materials]
 *     summary: Publish a study material (admin / teacher)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, fileUrl]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               fileUrl: { type: string, format: uri }
 *               classId: { type: string, format: uuid }
 *               subjectId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Created study material }
 */
studyMaterialsRouter.get("/", async (req, res) => {
  const params = listMaterialsQuerySchema.parse(req.query);
  res.json(await service.listMaterials(parsePagination(params), params, tenantId(req)));
});

studyMaterialsRouter.post("/", async (req, res) => {
  const input = createMaterialSchema.parse(req.body);
  res.status(201).json(await service.createMaterial(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /study-materials/{id}:
 *   get:
 *     tags: [Study Materials]
 *     summary: Get one study material
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Study material }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Study Materials]
 *     summary: Update a study material
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated study material }
 *   delete:
 *     tags: [Study Materials]
 *     summary: Delete a study material
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
studyMaterialsRouter.get("/:id", async (req, res) => {
  res.json(await service.getMaterial(uuidParam(req), tenantId(req)));
});

studyMaterialsRouter.patch("/:id", async (req, res) => {
  const input = updateMaterialSchema.parse(req.body);
  res.json(await service.updateMaterial(uuidParam(req), input, tenantId(req)));
});

studyMaterialsRouter.delete("/:id", async (req, res) => {
  await service.deleteMaterial(uuidParam(req), tenantId(req));
  res.status(204).end();
});
