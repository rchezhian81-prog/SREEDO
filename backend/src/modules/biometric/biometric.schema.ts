import { z } from "zod";

export const createDeviceSchema = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(200).optional(),
});

export const updateDeviceSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    location: z.string().max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .partial();

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  deviceId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

// Pushed by a device (authenticated by its device key, not a JWT).
export const ingestSchema = z.object({
  identifier: z.string().min(1).max(120),
  eventType: z.enum(["in", "out"]).optional(),
  eventTime: z.string().datetime().optional(),
});
