import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
});

export const createWebhookSchema = z.object({
  url: z.string().url().max(1000),
  description: z.string().max(300).optional(),
  eventTypes: z.string().max(300).optional(),
});

export const updateWebhookSchema = z
  .object({
    url: z.string().url().max(1000).optional(),
    description: z.string().max(300).optional(),
    eventTypes: z.string().max(300).optional(),
    isActive: z.boolean().optional(),
  })
  .partial();
