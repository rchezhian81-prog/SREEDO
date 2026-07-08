import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import { parsePagination } from "../../utils/pagination";
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementSchema,
} from "./announcements.schema";
import * as announcementsService from "./announcements.service";

export const announcementsRouter = Router();

announcementsRouter.use(authenticate, requireTenant);

const publisher = requirePermission("announcements:manage");

/** Publishers (admin/teacher) also see scheduled (future-dated) announcements. */
function canSeeScheduled(req: { user?: { role?: string } }): boolean {
  return req.user?.role === "admin" || req.user?.role === "teacher";
}

/**
 * @openapi
 * /announcements:
 *   get:
 *     tags: [Announcements]
 *     summary: List announcements (pinned first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: audience, schema: { type: string, enum: [all, teachers, students, parents, staff] } }
 *     responses:
 *       200: { description: Paginated announcements }
 *   post:
 *     tags: [Announcements]
 *     summary: Publish an announcement (admin/teacher)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string }
 *               body: { type: string }
 *               audience: { type: string, enum: [all, teachers, students, parents, staff] }
 *               isPinned: { type: boolean }
 *               publishAt: { type: string, format: date-time, description: "Schedule for a future time; hidden from the audience until then" }
 *     responses:
 *       201: { description: Created announcement }
 */
announcementsRouter.get("/", async (req, res) => {
  const queryParams = listAnnouncementsQuerySchema.parse(req.query);
  const result = await announcementsService.listAnnouncements(
    parsePagination(queryParams),
    {
      audience: queryParams.audience,
      includeScheduled: canSeeScheduled(req),
    },
    tenantId(req)
  );
  res.json(result);
});

announcementsRouter.post("/", publisher, async (req, res) => {
  const input = createAnnouncementSchema.parse(req.body);
  res
    .status(201)
    .json(
      await announcementsService.createAnnouncement(
        input,
        req.user!.id,
        tenantId(req)
      )
    );
});

/**
 * @openapi
 * /announcements/{id}:
 *   get:
 *     tags: [Announcements]
 *     summary: Get an announcement
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Announcement }
 *   patch:
 *     tags: [Announcements]
 *     summary: Update an announcement (admin/teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated announcement }
 *   delete:
 *     tags: [Announcements]
 *     summary: Delete an announcement (admin/teacher)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
announcementsRouter.get("/:id", async (req, res) => {
  res.json(
    await announcementsService.getAnnouncement(
      uuidParam(req),
      tenantId(req),
      canSeeScheduled(req)
    )
  );
});

announcementsRouter.patch("/:id", publisher, async (req, res) => {
  const input = updateAnnouncementSchema.parse(req.body);
  res.json(
    await announcementsService.updateAnnouncement(
      uuidParam(req),
      input,
      tenantId(req)
    )
  );
});

announcementsRouter.delete("/:id", publisher, async (req, res) => {
  await announcementsService.removeAnnouncement(uuidParam(req), tenantId(req));
  res.status(204).end();
});
