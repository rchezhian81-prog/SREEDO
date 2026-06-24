import { z } from "zod";

/**
 * Query for the institution-scoped activity log. There is deliberately NO
 * `institutionId` field here — the route always forces it to the caller's own
 * institution, so an admin can never read another tenant's activity.
 */
export const activityQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  module: z.string().max(40).optional(),
  action: z.string().max(10).optional(), // HTTP method (POST/PATCH/DELETE)
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
