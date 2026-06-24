import { z } from "zod";

export const createAlbumSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  coverUrl: z.string().url().max(1000).optional().or(z.literal("")),
});

export const updateAlbumSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    coverUrl: z.string().url().max(1000).optional().or(z.literal("")),
    isPublished: z.boolean().optional(),
  })
  .partial();

export const listAlbumsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
});

export const addPhotoSchema = z.object({
  imageUrl: z.string().url().max(1000),
  caption: z.string().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});
