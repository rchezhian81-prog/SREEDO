import { z } from "zod";

export const createHomeworkSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  instructions: z.string().max(5000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  maxMarks: z.coerce.number().min(0).max(1000).optional(),
});

export const updateHomeworkSchema = createHomeworkSchema
  .partial()
  .omit({ sectionId: true });

export const listHomeworkQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
});

export const submitHomeworkSchema = z.object({
  content: z.string().max(5000).optional(),
});

export const reviewSchema = z.object({
  status: z.enum(["submitted", "reviewed", "completed", "late", "resubmit"]),
  marks: z.coerce.number().min(0).max(1000).optional(),
  remarks: z.string().max(2000).optional(),
});
