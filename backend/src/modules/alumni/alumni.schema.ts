import { z } from "zod";

const baseFields = {
  fullName: z.string().min(1).max(200),
  batchYear: z.coerce.number().int().min(1900).max(2100),
  studentId: z.string().uuid().nullable().optional(),
  // Accept a valid email, omit it, or an empty string (cleared on the form).
  email: z.string().email().max(200).optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  currentCompany: z.string().max(200).optional(),
  currentRole: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  higherEducation: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
};

export const createAlumniSchema = z.object(baseFields);

export const updateAlumniSchema = z
  .object({
    ...baseFields,
    fullName: z.string().min(1).max(200).optional(),
    batchYear: z.coerce.number().int().min(1900).max(2100).optional(),
  })
  .partial();

export const listAlumniQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  batchYear: z.coerce.number().int().min(1900).max(2100).optional(),
  search: z.string().max(200).optional(),
});
