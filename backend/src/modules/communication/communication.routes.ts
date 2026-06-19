import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permissions";
import {
  absenceAlertSchema,
  deviceTokenSchema,
  feeReminderSchema,
  inboxQuerySchema,
  sendMessageSchema,
} from "./communication.schema";
import {
  addParticipantsSchema,
  createThreadSchema,
  replySchema,
} from "./threads.schema";
import * as service from "./communication.service";
import * as threads from "./threads.service";

export const communicationRouter = Router();

communicationRouter.use(authenticate, requireTenant);

const canRead = requirePermission("communication:read");
const canCompose = requirePermission("communication:create");
const canSend = requirePermission("communication:send");
const canDelete = requirePermission("communication:delete");
const canNotify = requirePermission("notifications:send");

const canThreadRead = requirePermission("threads:read");
const canThreadCreate = requirePermission("threads:create");
const canThreadReply = requirePermission("threads:reply");
const canThreadDelete = requirePermission("threads:delete");
const canThreadManage = requirePermission("threads:manage");

/**
 * @openapi
 * /communication/inbox:
 *   get:
 *     tags: [Communication]
 *     summary: The caller's own message inbox (owner-scoped)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: unread, schema: { type: string, enum: [true, false] } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: Inbox messages newest first }
 */
communicationRouter.get("/inbox", canRead, async (req, res) => {
  const q = inboxQuerySchema.parse(req.query);
  res.json(
    await service.listInbox(req.user!.id, tenantId(req), {
      unread: q.unread === "true",
      limit: q.limit,
    })
  );
});

/**
 * @openapi
 * /communication/inbox/unread-count:
 *   get:
 *     tags: [Communication]
 *     summary: Count of the caller's unread messages
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ count }" }
 */
communicationRouter.get("/inbox/unread-count", canRead, async (req, res) => {
  res.json(await service.unreadCount(req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/inbox/{id}/read:
 *   post:
 *     tags: [Communication]
 *     summary: Mark one of the caller's messages as read
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Marked read }
 *       404: { description: Not in your inbox }
 */
communicationRouter.post("/inbox/:id/read", canRead, async (req, res) => {
  await service.markRead(uuidParam(req), req.user!.id, tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /communication/messages:
 *   get:
 *     tags: [Communication]
 *     summary: Sent-message history with delivery (read) counts (staff)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Messages with recipient/read counts }
 *   post:
 *     tags: [Communication]
 *     summary: Compose and send an in-app message to an audience
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, body, audienceType]
 *             properties:
 *               subject: { type: string }
 *               body: { type: string }
 *               category: { type: string, enum: [message, announcement, general] }
 *               audienceType: { type: string, enum: [all_students, all_parents, staff, section, class, student, parent, user] }
 *               audienceRef: { type: string, format: uuid, description: Required for section/class/student/parent/user }
 *     responses:
 *       201: { description: "{ messageId, recipientCount }" }
 */
communicationRouter.get("/messages", canCompose, async (req, res) => {
  res.json(await service.listSent(tenantId(req), {}));
});

communicationRouter.post("/messages", canSend, async (req, res) => {
  const input = sendMessageSchema.parse(req.body);
  res.status(201).json(await service.sendMessage(req.user!.id, input, tenantId(req)));
});

/**
 * @openapi
 * /communication/messages/{id}:
 *   delete:
 *     tags: [Communication]
 *     summary: Delete a message (and its recipient rows)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
communicationRouter.delete("/messages/:id", canDelete, async (req, res) => {
  await service.deleteMessage(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /communication/fee-reminders:
 *   post:
 *     tags: [Communication]
 *     summary: Send fee reminders to students (and guardians) with outstanding fees
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               studentId: { type: string, format: uuid, description: Limit to one student }
 *     responses:
 *       200: { description: "{ students, recipients }" }
 */
communicationRouter.post("/fee-reminders", canNotify, async (req, res) => {
  const { studentId } = feeReminderSchema.parse(req.body ?? {});
  res.json(
    await service.generateFeeReminders(tenantId(req), req.user!.id, { studentId })
  );
});

/**
 * @openapi
 * /communication/absence-alerts:
 *   post:
 *     tags: [Communication]
 *     summary: Send absence alerts for a date's absentees (de-duplicated per student/date)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date]
 *             properties:
 *               date: { type: string, format: date }
 *               force: { type: boolean, description: Resend even if already alerted }
 *     responses:
 *       200: { description: "{ students, recipients }" }
 */
communicationRouter.post("/absence-alerts", canNotify, async (req, res) => {
  const { date, force } = absenceAlertSchema.parse(req.body);
  res.json(
    await service.generateAbsenceAlerts(
      tenantId(req),
      req.user!.id,
      date,
      force ?? false
    )
  );
});

/**
 * @openapi
 * /communication/device-tokens:
 *   post:
 *     tags: [Communication]
 *     summary: Register the caller's device token for push notifications
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *               platform: { type: string, example: android }
 *     responses:
 *       201: { description: Registered }
 */
communicationRouter.post("/device-tokens", async (req, res) => {
  const { token, platform } = deviceTokenSchema.parse(req.body);
  res
    .status(201)
    .json(await service.registerDeviceToken(req.user!.id, tenantId(req), token, platform));
});

communicationRouter.delete("/device-tokens", async (req, res) => {
  const { token } = deviceTokenSchema.parse(req.body);
  await service.removeDeviceToken(token, req.user!.id, tenantId(req));
  res.status(204).end();
});

// --- Threaded messaging (conversation threads + replies + read state) ---
// Participant-scoped: a thread is visible only to its participants.

/**
 * @openapi
 * /communication/threads:
 *   get: { tags: [Communication], summary: List my conversation threads, security: [{ bearerAuth: [] }], responses: { 200: { description: Threads with unread counts } } }
 *   post: { tags: [Communication], summary: Start a conversation thread (one-to-one or group), security: [{ bearerAuth: [] }], responses: { 201: { description: Created thread } } }
 */
communicationRouter.get("/threads", canThreadRead, async (req, res) => {
  res.json(await threads.listThreads(req.user!.id, tenantId(req)));
});
communicationRouter.post("/threads", canThreadCreate, async (req, res) => {
  const input = createThreadSchema.parse(req.body);
  res.status(201).json(await threads.createThread(input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/threads/unread-count:
 *   get: { tags: [Communication], summary: Total unread messages across my threads, security: [{ bearerAuth: [] }], responses: { 200: { description: "{ count }" } } }
 */
communicationRouter.get("/threads/unread-count", canThreadRead, async (req, res) => {
  res.json(await threads.unreadCount(req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/threads/{id}:
 *   get: { tags: [Communication], summary: Thread detail with participants + messages (participant-only), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Thread }, 404: { description: Not a participant } } }
 *   delete: { tags: [Communication], summary: Archive the thread for me, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Archived } } }
 */
communicationRouter.get("/threads/:id", canThreadRead, async (req, res) => {
  res.json(await threads.getThread(uuidParam(req), req.user!.id, tenantId(req)));
});
communicationRouter.delete("/threads/:id", canThreadDelete, async (req, res) => {
  res.json(await threads.archiveThread(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/threads/{id}/messages:
 *   post: { tags: [Communication], summary: Reply in a thread (participant-only; notifies others), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Reply } } }
 */
communicationRouter.post("/threads/:id/messages", canThreadReply, async (req, res) => {
  const input = replySchema.parse(req.body);
  res.status(201).json(await threads.reply(uuidParam(req), input, req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/threads/{id}/read:
 *   post: { tags: [Communication], summary: Mark a thread read for me, security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ ok }" } } }
 */
communicationRouter.post("/threads/:id/read", canThreadRead, async (req, res) => {
  res.json(await threads.markRead(uuidParam(req), req.user!.id, tenantId(req)));
});

/**
 * @openapi
 * /communication/threads/{id}/participants:
 *   post: { tags: [Communication], summary: Add participants to a thread (threads:manage), security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Updated thread } } }
 */
communicationRouter.post("/threads/:id/participants", canThreadManage, async (req, res) => {
  const input = addParticipantsSchema.parse(req.body);
  res.json(await threads.addParticipants(uuidParam(req), input, req.user!.id, tenantId(req)));
});
