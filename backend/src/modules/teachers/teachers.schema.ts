import { z } from "zod";

export const createTeacherSchema = z.object({
  employeeNo: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  qualification: z.string().max(200).optional(),
  specialization: z.string().max(200).optional(),
  joiningDate: z.string().date().optional(),
  // PR-T6 — staff master. Non-teaching staff live in the same table (teaching is
  // the default so every existing/teacher flow is unchanged); designation is the
  // non-teaching role title (e.g. Accountant, Clerk, Driver).
  staffType: z.enum(["teaching", "non_teaching"]).optional(),
  designation: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
});

export const updateTeacherSchema = createTeacherSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const listTeachersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  // Absent → teaching-only (preserves the existing Teachers list + assignment
  // pickers). Pass non_teaching for the Staff Directory, or all for everyone.
  staffType: z.enum(["teaching", "non_teaching", "all"]).optional(),
});

export const importTeachersSchema = z.object({
  rows: z
    .array(createTeacherSchema)
    .min(1, "At least one row is required")
    .max(1000, "Import is limited to 1000 rows at a time"),
});
