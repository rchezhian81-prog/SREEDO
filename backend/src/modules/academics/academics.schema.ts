import { z } from "zod";

export const createAcademicYearSchema = z.object({
  name: z.string().min(1).max(50),
  startDate: z.string().date(),
  endDate: z.string().date(),
  isCurrent: z.boolean().optional(),
});

export const createClassSchema = z.object({
  name: z.string().min(1).max(100),
  gradeLevel: z.number().int().min(0).max(20),
});

export const createSectionSchema = z.object({
  name: z.string().min(1).max(20),
  homeroomTeacherId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().positive().optional(),
});

export const createSubjectSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
});
