import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import {
  createAdmissionSchema,
  updateAdmissionSchema,
  listAdmissionsQuerySchema,
  convertAdmissionSchema,
  publicEnquirySchema,
} from "./admissions.schema";
import * as service from "./admissions.service";

export const admissionsRouter = Router();

/**
 * @openapi
 * /admissions/enquiry:
 *   post:
 *     tags: [Admissions]
 *     summary: Public admission enquiry (no auth) — submit interest in a school
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [institutionCode, firstName, lastName]
 *             properties:
 *               institutionCode: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               gender: { type: string, enum: [male, female, other] }
 *               gradeApplying: { type: string }
 *               guardianName: { type: string }
 *               guardianPhone: { type: string }
 *               guardianEmail: { type: string, format: email }
 *               address: { type: string }
 *               notes: { type: string }
 *     responses:
 *       201: { description: "Enquiry received { id, status }" }
 *       404: { description: No school for that code }
 */
admissionsRouter.post("/enquiry", async (req, res) => {
  const input = publicEnquirySchema.parse(req.body);
  res.status(201).json(await service.createPublicEnquiry(input));
});

// Everything below is institution-admin only, scoped to the caller's tenant.
admissionsRouter.use(authenticate, requireTenant);

/**
 * @openapi
 * /admissions:
 *   get:
 *     tags: [Admissions]
 *     summary: List admission applications (filter by status, search)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: status, schema: { type: string, enum: [enquiry, applied, under_review, admitted, rejected, enrolled] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Paginated applications }
 *   post:
 *     tags: [Admissions]
 *     summary: Create an admission application / enquiry (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               gender: { type: string, enum: [male, female, other] }
 *               gradeApplying: { type: string }
 *               guardianName: { type: string }
 *               guardianPhone: { type: string }
 *               guardianEmail: { type: string, format: email }
 *               address: { type: string }
 *               source: { type: string }
 *               status: { type: string, enum: [enquiry, applied, under_review, admitted, rejected, enrolled] }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Created application }
 */
admissionsRouter.get("/", requirePermission("admissions:read"), async (req, res) => {
  const params = listAdmissionsQuerySchema.parse(req.query);
  res.json(
    await service.listAdmissions(parsePagination(params), params, tenantId(req))
  );
});

admissionsRouter.post("/", requirePermission("admissions:create"), async (req, res) => {
  const input = createAdmissionSchema.parse(req.body);
  res.status(201).json(await service.createAdmission(input, tenantId(req)));
});

/**
 * @openapi
 * /admissions/{id}:
 *   get:
 *     tags: [Admissions]
 *     summary: Get one application
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Application }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Admissions]
 *     summary: Update an application (fields / status)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated application }
 *   delete:
 *     tags: [Admissions]
 *     summary: Delete an application
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
admissionsRouter.get("/:id", requirePermission("admissions:read"), async (req, res) => {
  res.json(await service.getAdmission(uuidParam(req), tenantId(req)));
});

admissionsRouter.patch("/:id", requirePermission("admissions:update"), async (req, res) => {
  const input = updateAdmissionSchema.parse(req.body);
  res.json(await service.updateAdmission(uuidParam(req), input, tenantId(req)));
});

admissionsRouter.delete("/:id", requirePermission("admissions:delete"), async (req, res) => {
  await service.deleteAdmission(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /admissions/{id}/convert:
 *   post:
 *     tags: [Admissions]
 *     summary: Enroll an admitted applicant as a student
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sectionId: { type: string, format: uuid }
 *               admissionNo: { type: string }
 *     responses:
 *       200: { description: "{ student, application }" }
 *       400: { description: Already enrolled }
 */
admissionsRouter.post("/:id/convert", requirePermission("admissions:convert"), async (req, res) => {
  const input = convertAdmissionSchema.parse(req.body);
  res.json(await service.convertToStudent(uuidParam(req), input, tenantId(req)));
});
