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

// Assign a subject (optionally with a teacher) to a section — a row in
// class_subjects. The (section, subject) pair is unique.
export const assignSectionSubjectSchema = z.object({
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid().nullable().optional(),
});

// Reassign (or clear, with null) the teacher on a section's subject.
export const updateClassSubjectSchema = z.object({
  teacherId: z.string().uuid().nullable(),
});
