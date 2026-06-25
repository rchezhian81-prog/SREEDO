import { z } from "zod";

export const LIVE_CLASS_PROVIDERS = [
  "zoom",
  "meet",
  "teams",
  "jitsi",
  "other",
] as const;

export const LIVE_CLASS_STATUSES = [
  "scheduled",
  "live",
  "completed",
  "cancelled",
] as const;

export const createLiveClassSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  subject: z.string().max(120).optional(),
  target: z.string().max(120).optional(),
  provider: z.enum(LIVE_CLASS_PROVIDERS).default("meet"),
  joinUrl: z.string().url().max(1000),
  hostName: z.string().max(120).optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(600).default(60),
});

export const updateLiveClassSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  subject: z.string().max(120).nullable().optional(),
  target: z.string().max(120).nullable().optional(),
  provider: z.enum(LIVE_CLASS_PROVIDERS).optional(),
  joinUrl: z.string().url().max(1000).optional(),
  hostName: z.string().max(120).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  durationMin: z.number().int().min(5).max(600).optional(),
  status: z.enum(LIVE_CLASS_STATUSES).optional(),
});

export type CreateLiveClassInput = z.infer<typeof createLiveClassSchema>;
export type UpdateLiveClassInput = z.infer<typeof updateLiveClassSchema>;
