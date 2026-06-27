import { z } from "zod";

export const OWNER_TYPES = ["student", "user", "institution", "message"] as const;
export const CATEGORIES = [
  "profile_photo",
  "id_card",
  "certificate",
  "tc",
  "document",
  "logo",
  "attachment",
] as const;

export const uploadFieldsSchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().uuid().optional(),
  category: z.enum(CATEGORIES).optional(),
});

export const listQuerySchema = z.object({
  ownerType: z.enum(OWNER_TYPES).optional(),
  ownerId: z.string().uuid().optional(),
  category: z.enum(CATEGORIES).optional(),
});
