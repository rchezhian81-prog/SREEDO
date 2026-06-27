import { z } from "zod";

export const createThreadSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  participantIds: z.array(z.string().uuid()).min(1).max(100),
  body: z.string().min(1).max(5000).optional(),
});

export const replySchema = z.object({
  body: z.string().min(1).max(5000),
});

export const addParticipantsSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(100),
});
