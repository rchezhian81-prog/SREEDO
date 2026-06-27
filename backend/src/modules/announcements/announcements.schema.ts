import { z } from "zod";

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(10_000),
  audience: z
    .enum(["all", "teachers", "students", "parents", "staff"])
    .optional(),
  isPinned: z.boolean().optional(),
  // Optional ISO-8601 timestamp to schedule the announcement: until it passes
  // the announcement is hidden from the audience (publishers still see it).
  publishAt: z.string().datetime().optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

export const listAnnouncementsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  audience: z
    .enum(["all", "teachers", "students", "parents", "staff"])
    .optional(),
});
