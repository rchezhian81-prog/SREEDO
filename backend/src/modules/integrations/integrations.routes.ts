import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import {
  createApiKeySchema,
  createWebhookSchema,
  updateWebhookSchema,
} from "./integrations.schema";
import * as service from "./integrations.service";

// Integrations (API keys + webhooks) — institution-admin only, tenant-scoped.
export const integrationsRouter = Router();
integrationsRouter.use(authenticate, requireTenant, authorize("admin"));

/**
 * @openapi
 * /integrations/api-keys:
 *   get:
 *     tags: [Integrations]
 *     summary: List API keys (masked — the secret is shown only once at creation)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: API keys }
 *   post:
 *     tags: [Integrations]
 *     summary: Create an API key (returns the full key once)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties: { name: { type: string } }
 *     responses:
 *       201: { description: "{ id, name, key, keyPrefix } — key shown once" }
 */
integrationsRouter.get("/api-keys", async (req, res) => {
  res.json(await service.listApiKeys(tenantId(req)));
});

integrationsRouter.post("/api-keys", async (req, res) => {
  const input = createApiKeySchema.parse(req.body);
  res.status(201).json(await service.createApiKey(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /integrations/api-keys/{id}/revoke:
 *   post:
 *     tags: [Integrations]
 *     summary: Revoke (deactivate) an API key
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Revoked }
 *       404: { description: Not found }
 */
integrationsRouter.post("/api-keys/:id/revoke", async (req, res) => {
  res.json(await service.revokeApiKey(uuidParam(req), tenantId(req)));
});

/**
 * @openapi
 * /integrations/api-keys/{id}:
 *   delete:
 *     tags: [Integrations]
 *     summary: Delete an API key
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
integrationsRouter.delete("/api-keys/:id", async (req, res) => {
  await service.deleteApiKey(uuidParam(req), tenantId(req));
  res.status(204).end();
});

/**
 * @openapi
 * /integrations/webhooks:
 *   get:
 *     tags: [Integrations]
 *     summary: List webhook endpoints
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Webhook endpoints }
 *   post:
 *     tags: [Integrations]
 *     summary: Register a webhook endpoint
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri }
 *               description: { type: string }
 *               eventTypes: { type: string }
 *     responses:
 *       201: { description: Created webhook }
 */
integrationsRouter.get("/webhooks", async (req, res) => {
  res.json(await service.listWebhooks(tenantId(req)));
});

integrationsRouter.post("/webhooks", async (req, res) => {
  const input = createWebhookSchema.parse(req.body);
  res.status(201).json(await service.createWebhook(input, tenantId(req), req.user!.id));
});

/**
 * @openapi
 * /integrations/webhooks/{id}:
 *   patch:
 *     tags: [Integrations]
 *     summary: Update a webhook endpoint
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated webhook }
 *   delete:
 *     tags: [Integrations]
 *     summary: Delete a webhook endpoint
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       204: { description: Deleted }
 */
integrationsRouter.patch("/webhooks/:id", async (req, res) => {
  const input = updateWebhookSchema.parse(req.body);
  res.json(await service.updateWebhook(uuidParam(req), input, tenantId(req)));
});

integrationsRouter.delete("/webhooks/:id", async (req, res) => {
  await service.deleteWebhook(uuidParam(req), tenantId(req));
  res.status(204).end();
});
