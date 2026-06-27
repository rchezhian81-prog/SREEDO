import { z } from "zod";

export const OPTIONS = ["A", "B", "C", "D"] as const;

export const createQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  classId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
});

export const updateQuizSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    classId: z.string().uuid().nullable().optional(),
    subjectId: z.string().uuid().nullable().optional(),
    isPublished: z.boolean().optional(),
  })
  .partial();

export const listQuizzesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  published: z.enum(["true", "false"]).optional(),
});

export const createQuestionSchema = z
  .object({
    questionText: z.string().min(1).max(2000),
    optionA: z.string().min(1).max(500),
    optionB: z.string().min(1).max(500),
    optionC: z.string().max(500).optional(),
    optionD: z.string().max(500).optional(),
    correctOption: z.enum(OPTIONS),
    marks: z.coerce.number().int().positive().max(100).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (q) =>
      (q.correctOption !== "C" || (q.optionC && q.optionC.length > 0)) &&
      (q.correctOption !== "D" || (q.optionD && q.optionD.length > 0)),
    { message: "The correct option must reference a provided option", path: ["correctOption"] }
  );

export const updateQuestionSchema = z
  .object({
    questionText: z.string().min(1).max(2000).optional(),
    optionA: z.string().min(1).max(500).optional(),
    optionB: z.string().min(1).max(500).optional(),
    optionC: z.string().max(500).nullable().optional(),
    optionD: z.string().max(500).nullable().optional(),
    correctOption: z.enum(OPTIONS).optional(),
    marks: z.coerce.number().int().positive().max(100).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .partial();

// Student submission: a map of questionId -> chosen option.
export const submitAttemptSchema = z.object({
  answers: z.record(z.string().uuid(), z.enum(OPTIONS)),
});
