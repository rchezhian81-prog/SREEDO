import { z } from "zod";

export const AUDIENCE_TYPES = [
  "all_students",
  "all_parents",
  "staff",
  "section",
  "class",
  "student",
  "parent",
  "user",
] as const;

const REF_REQUIRED = ["section", "class", "student", "parent", "user"];

export const sendMessageSchema = z
  .object({
    subject: z.string().min(1).max(160),
    body: z.string().min(1).max(5000),
    category: z.enum(["message", "announcement", "general"]).optional(),
    audienceType: z.enum(AUDIENCE_TYPES),
    audienceRef: z.string().uuid().optional(),
  })
  .refine((d) => !REF_REQUIRED.includes(d.audienceType) || !!d.audienceRef, {
    message: "audienceRef is required for this audience",
    path: ["audienceRef"],
  });

export const inboxQuerySchema = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const deviceTokenSchema = z.object({
  token: z.string().min(8).max(512),
  platform: z.string().max(40).optional(),
});

export const feeReminderSchema = z.object({
  studentId: z.string().uuid().optional(),
});

export const absenceAlertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  force: z.boolean().optional(),
});
