import { z } from "zod";

export const ITEM_TYPES = ["lost", "found"] as const;
export const ITEM_STATUSES = ["open", "claimed", "returned", "closed"] as const;

const baseFields = {
  type: z.enum(ITEM_TYPES).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  location: z.string().max(200).optional(),
  reporterName: z.string().max(200).optional(),
  reporterContact: z.string().max(120).optional(),
  itemDate: z.string().date().optional(),
};

export const createItemSchema = z.object(baseFields);

export const updateItemSchema = z
  .object({
    ...baseFields,
    title: z.string().min(1).max(200).optional(),
    status: z.enum(ITEM_STATUSES).optional(),
  })
  .partial();

export const listItemsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  search: z.string().max(200).optional(),
});
