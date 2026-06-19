import { z } from "zod";

export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export const CHANNELS = ["in_app", "email"] as const;
export const FORMATS = ["csv", "pdf", "both"] as const;

const runTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "run time must be HH:MM (24h)");

export const createScheduleSchema = z.object({
  reportId: z.string().uuid(),
  name: z.string().min(1).max(200),
  frequency: z.enum(FREQUENCIES),
  runTime: runTime.optional(),
  timezone: z.string().max(64).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  recipients: z.array(z.string().uuid()).max(200).optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(2).optional(),
  exportFormat: z.enum(FORMATS).optional(),
  enabled: z.boolean().optional(),
});

export const updateScheduleSchema = z.object({
  reportId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  runTime: runTime.optional(),
  timezone: z.string().max(64).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  recipients: z.array(z.string().uuid()).max(200).optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(2).optional(),
  exportFormat: z.enum(FORMATS).optional(),
  enabled: z.boolean().optional(),
});

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
