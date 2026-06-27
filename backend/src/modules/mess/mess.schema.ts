import { z } from "zod";

export const MEALS = ["breakfast", "lunch", "snacks", "dinner"] as const;

const baseFields = {
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  meal: z.enum(MEALS),
  items: z.string().min(1).max(2000),
  notes: z.string().max(1000).optional(),
};

export const createMenuItemSchema = z.object(baseFields);

export const updateMenuItemSchema = z
  .object({
    ...baseFields,
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    meal: z.enum(MEALS).optional(),
    items: z.string().min(1).max(2000).optional(),
  })
  .partial();

export const listMenuQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  meal: z.enum(MEALS).optional(),
});
