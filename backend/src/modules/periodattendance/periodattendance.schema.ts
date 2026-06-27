import { z } from "zod";

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;

export const rosterQuerySchema = z.object({
  sectionId: z.string().uuid(),
  date: z.string().date(),
  periodId: z.string().uuid(),
});

export const markSchema = z.object({
  date: z.string().date(),
  periodId: z.string().uuid(),
  subjectId: z.string().uuid().nullable().optional(),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
      })
    )
    .min(1)
    .max(200),
});
