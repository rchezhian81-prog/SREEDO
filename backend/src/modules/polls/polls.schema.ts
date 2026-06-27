import { z } from "zod";

export const createPollSchema = z.object({
  question: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  classId: z.string().uuid().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  // At least two options to create a meaningful poll.
  options: z.array(z.string().min(1).max(300)).min(2).max(10),
});

export const updatePollSchema = z
  .object({
    question: z.string().min(1).max(500).optional(),
    description: z.string().max(2000).optional(),
    classId: z.string().uuid().nullable().optional(),
    closesAt: z.string().datetime().nullable().optional(),
    isPublished: z.boolean().optional(),
  })
  .partial();

export const listPollsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  classId: z.string().uuid().optional(),
  published: z.enum(["true", "false"]).optional(),
});

export const voteSchema = z.object({
  optionId: z.string().uuid(),
});
