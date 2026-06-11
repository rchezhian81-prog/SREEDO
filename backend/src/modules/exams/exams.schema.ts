import { z } from "zod";

export const createExamSchema = z.object({
  name: z.string().min(1).max(200),
  academicYearId: z.string().uuid().nullable().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});

export const upsertResultsSchema = z.object({
  results: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        subjectId: z.string().uuid(),
        marksObtained: z.number().nonnegative(),
        maxMarks: z.number().positive().optional(),
        grade: z.string().max(5).optional(),
        remarks: z.string().max(500).optional(),
      })
    )
    .min(1)
    .max(500),
});
