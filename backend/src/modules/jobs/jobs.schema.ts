import { z } from "zod";

export const JOB_STATUSES = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
] as const;

export const listJobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.string().max(80).optional(),
  institutionId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
