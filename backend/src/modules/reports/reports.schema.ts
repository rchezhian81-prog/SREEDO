import { z } from "zod";

export const createGradeBandSchema = z.object({
  grade: z.string().min(1).max(10),
  minPercent: z.coerce.number().min(0).max(100),
  maxPercent: z.coerce.number().min(0).max(100),
  remark: z.string().max(120).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100).optional(),
});

export const updateGradeBandSchema = createGradeBandSchema.partial();

export const reportCardQuerySchema = z.object({
  examId: z.string().uuid(),
  studentId: z.string().uuid(),
});

export const markSheetQuerySchema = z.object({
  examId: z.string().uuid(),
  sectionId: z.string().uuid(),
});
