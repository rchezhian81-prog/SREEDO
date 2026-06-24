import { z } from "zod";

export const createVisitSchema = z.object({
  patientName: z.string().min(1).max(200),
  studentId: z.string().uuid().nullable().optional(),
  visitDate: z.string().date(),
  complaint: z.string().max(1000).optional(),
  treatment: z.string().max(1000).optional(),
  temperature: z.string().max(20).optional(),
  remarks: z.string().max(1000).optional(),
});

export const updateVisitSchema = createVisitSchema.partial();

export const listVisitsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
