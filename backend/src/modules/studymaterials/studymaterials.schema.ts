import { z } from "zod";

const baseFields = {
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  fileUrl: z.string().url().max(1000),
  classId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
};

export const createMaterialSchema = z.object(baseFields);

export const updateMaterialSchema = z
  .object({
    ...baseFields,
    title: z.string().min(1).max(200).optional(),
    fileUrl: z.string().url().max(1000).optional(),
  })
  .partial();

export const listMaterialsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
