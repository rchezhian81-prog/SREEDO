import { z } from "zod";

export const generateSchema = z.object({
  // Working days as day-of-week numbers (0 = Sunday … 6 = Saturday).
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7).optional(),
  // Optional subset of sections; defaults to every section that has subjects.
  sectionIds: z.array(z.string().uuid()).max(500).optional(),
});
