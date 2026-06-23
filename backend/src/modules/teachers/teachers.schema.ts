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
});

export const updateTeacherSchema = createTeacherSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const listTeachersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
});

export const importTeachersSchema = z.object({
  rows: z
    .array(createTeacherSchema)
    .min(1, "At least one row is required")
    .max(1000, "Import is limited to 1000 rows at a time"),
});
