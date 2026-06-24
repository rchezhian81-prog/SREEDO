import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { parsePagination } from "../../utils/pagination";
import {
  createAlumniSchema,
  updateAlumniSchema,
  listAlumniQuerySchema,
} from "./alumni.schema";
import * as service from "./alumni.service";

// Alumni & placement directory — institution-admin only, tenant-scoped.
export const alumniRouter = Router();
alumniRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /alumni:
 *   get:
 *     tags: [Alumni]
 *     summary: List alumni (filter by batch year, search name/company/email)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: batchYear, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated alumni }
 *   post:
 *     tags: [Alumni]
 *     summary: Add an alumnus
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, batchYear]
 *             properties:
 *               fullName: { type: string }
 *               batchYear: { type: integer }
 *               studentId: { type: string, format: uuid }
 *               email: { type: string }
 *               phone: { type: string }
 *               currentCompany: { type: string }
 *               currentRole: { type: string }
 *               location: { type: string }
 *               higherEducation: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Created alumnus }
 */
alumniRouter.get("/", async (req, res) => {
  const params = listAlumniQuerySchema.parse(req.query);
  res.json(await service.listAlumni(parsePagination(params), params, tenantId(req)));
});

alumniRouter.post("/", async (req, res) => {
  const input = createAlumniSchema.parse(req.body);
  res.status(201).json(await service.createAlumnus(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /alumni/{id}:
 *   get:
 *     tags: [Alumni]
 *     summary: Get one alumnus
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Alumnus }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Alumni]
 *     summary: Update an alumnus
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated alumnus }
 *   delete:
 *     tags: [Alumni]
 *     summary: Delete an alumnus
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
alumniRouter.get("/:id", async (req, res) => {
  res.json(await service.getAlumnus(uuidParam(req), tenantId(req)));
});

alumniRouter.patch("/:id", async (req, res) => {
  const input = updateAlumniSchema.parse(req.body);
  res.json(await service.updateAlumnus(uuidParam(req), input, tenantId(req)));
});

alumniRouter.delete("/:id", async (req, res) => {
  await service.deleteAlumnus(uuidParam(req), tenantId(req));
  res.status(204).end();
});
