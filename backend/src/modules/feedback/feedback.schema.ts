import { z } from "zod";

// PR-T7 — "enquiry" added so front-desk walk-in / phone enquiries log in the same
// complaints/feedback surface. Additive only; feedback_entries.type is free TEXT
// (no DB CHECK), so no migration is required.
export const FEEDBACK_TYPES = ["feedback", "complaint", "suggestion", "grievance", "enquiry"] as const;
export const FEEDBACK_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

const baseFields = {
  type: z.enum(FEEDBACK_TYPES).optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
  submitterName: z.string().max(200).optional(),
  submitterContact: z.string().max(120).optional(),
};

export const createFeedbackSchema = z.object(baseFields);

export const updateFeedbackSchema = z
  .object({
    ...baseFields,
    subject: z.string().min(1).max(200).optional(),
    message: z.string().min(1).max(4000).optional(),
    status: z.enum(FEEDBACK_STATUSES).optional(),
    resolution: z.string().max(4000).optional(),
  })
  .partial();

export const listFeedbackQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  search: z.string().max(200).optional(),
});

// Public submission (no auth): resolved to a school by its code.
export const publicFeedbackSchema = z.object({
  institutionCode: z.string().min(2).max(40),
  ...baseFields,
});
