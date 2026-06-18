import { z } from "zod";

export const updateSettingsSchema = z.object({
  type: z.enum(["school", "college"]),
});

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40),
  headTeacherId: z.string().uuid().nullish(),
});
export const updateDepartmentSchema = createDepartmentSchema.partial();

export const createProgramSchema = z.object({
  departmentId: z.string().uuid(),
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40),
  durationSemesters: z.coerce.number().int().min(1).max(20).optional(),
});
export const updateProgramSchema = createProgramSchema.partial().omit({ departmentId: true });

export const createSemesterSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(1).max(80),
  number: z.coerce.number().int().min(1).max(20),
  academicYearId: z.string().uuid().nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export const updateSemesterSchema = createSemesterSchema.partial().omit({ programId: true });

export const createBatchSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().min(1).max(80),
  startYear: z.coerce.number().int().min(1900).max(2200).optional(),
});

export const createProgramSubjectSchema = z.object({
  programId: z.string().uuid(),
  semesterId: z.string().uuid().nullish(),
  subjectId: z.string().uuid(),
  credits: z.coerce.number().min(0).max(20).optional(),
});

export const createEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
  programId: z.string().uuid(),
  semesterId: z.string().uuid().nullish(),
  batchId: z.string().uuid().nullish(),
  status: z.string().max(40).optional(),
});
export const updateEnrollmentSchema = z.object({
  semesterId: z.string().uuid().nullish(),
  batchId: z.string().uuid().nullish(),
  status: z.string().max(40).optional(),
});

export const createStaffAllocationSchema = z
  .object({
    teacherId: z.string().uuid(),
    departmentId: z.string().uuid().nullish(),
    programId: z.string().uuid().nullish(),
    subjectId: z.string().uuid().nullish(),
  })
  .refine((d) => d.departmentId || d.programId || d.subjectId, {
    message: "At least one of department/program/subject is required",
  });
