import { z } from "zod";

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = [
  "open",
  "under_review",
  "action_taken",
  "closed",
  "cancelled",
] as const;

export const createDisciplinarySchema = z.object({
  studentId: z.string().uuid(),
  incidentDate: z.string().date(),
  category: z.string().min(1).max(120),
  severity: z.enum(SEVERITIES),
  description: z.string().max(2000).nullable().optional(),
  reportedBy: z.string().max(200).nullable().optional(),
  involvedStaff: z.string().max(500).nullable().optional(),
  actionTaken: z.string().max(2000).nullable().optional(),
  followUpDate: z.string().date().nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
});

export const updateDisciplinarySchema = z.object({
  incidentDate: z.string().date().optional(),
  category: z.string().min(1).max(120).optional(),
  severity: z.enum(SEVERITIES).optional(),
  description: z.string().max(2000).nullable().optional(),
  reportedBy: z.string().max(200).nullable().optional(),
  involvedStaff: z.string().max(500).nullable().optional(),
  followUpDate: z.string().date().nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
});

/** Record an action taken (moves the record to `action_taken`). */
export const actionDisciplinarySchema = z.object({
  actionTaken: z.string().min(1).max(2000),
  followUpDate: z.string().date().nullable().optional(),
  note: z.string().max(1000).optional(),
});

/** A note-only workflow step (mark under review / close). */
export const noteSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const cancelDisciplinarySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listDisciplinaryQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  studentId: z.string().uuid().optional(),
  category: z.string().max(120).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  search: z.string().max(100).optional(),
});

export const portalSettingsSchema = z.object({
  portalEnabled: z.boolean(),
});
