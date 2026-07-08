import { z } from "zod";

// Homework targets EITHER a section (school) or a semester (college). The shared
// fields live on a base object so the update schema can `.partial().omit()` the
// immutable target; `createHomeworkSchema` layers a one-of refinement on top.
const homeworkFields = z.object({
  sectionId: z.string().uuid().optional(),
  semesterId: z.string().uuid().optional(),
  subjectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  instructions: z.string().max(5000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  maxMarks: z.coerce.number().min(0).max(1000).optional(),
});

export const createHomeworkSchema = homeworkFields.refine(
  (d) => Boolean(d.sectionId) !== Boolean(d.semesterId),
  { message: "Provide exactly one of a section or a semester", path: ["sectionId"] }
);

// The target is immutable after creation, so both cohort keys are omitted here.
export const updateHomeworkSchema = homeworkFields
  .partial()
  .omit({ sectionId: true, semesterId: true });

export const listHomeworkQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  semesterId: z.string().uuid().optional(),
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
