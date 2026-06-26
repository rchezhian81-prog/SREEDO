import { z } from "zod";

export const createStudentSchema = z.object({
  admissionNo: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  sectionId: z.string().uuid().nullable().optional(),
  guardianName: z.string().max(200).optional(),
  guardianPhone: z.string().max(30).optional(),
  guardianEmail: z.string().email().optional(),
  guardianRelation: z.enum(["father", "mother", "guardian", "other"]).optional(),
  address: z.string().max(500).optional(),
  bloodGroup: z.string().max(10).optional(),
  nationality: z.string().max(60).optional(),
  religion: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  nationalId: z.string().max(40).optional(),
  admissionDate: z.string().date().optional(),
  rollNumber: z.string().max(40).optional(),
  previousSchool: z.string().max(200).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
});

export const updateStudentSchema = createStudentSchema
  .partial()
  .extend({
    status: z
      .enum(["active", "inactive", "graduated", "transferred", "archived"])
      .optional(),
  });

export const listStudentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sectionId: z.string().uuid().optional(),
  status: z
    .enum(["active", "inactive", "graduated", "transferred", "archived"])
    .optional(),
  search: z.string().max(200).optional(),
});

export const deleteStudentQuerySchema = z.object({
  hard: z.coerce.boolean().optional(),
});

export const importStudentsSchema = z.object({
  rows: z
    .array(createStudentSchema)
    .min(1, "At least one row is required")
    .max(1000, "Import is limited to 1000 rows at a time"),
});

export const linkGuardianSchema = z.object({
  userId: z.string().uuid(),
  relationship: z.string().min(1).max(50).optional(),
});
