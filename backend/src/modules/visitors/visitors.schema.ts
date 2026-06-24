import { z } from "zod";

export const createVisitorSchema = z.object({
  visitorName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  purpose: z.string().max(300).optional(),
  whomToMeet: z.string().max(200).optional(),
  badgeNo: z.string().max(40).optional(),
});

export const updateVisitorSchema = createVisitorSchema.partial();

export const listVisitorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  // "true" = only visitors currently checked in (no out_time yet).
  active: z.enum(["true", "false"]).optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
