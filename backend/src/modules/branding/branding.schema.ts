import { z } from "zod";

export const updateBrandingSchema = z.object({
  displayName: z.string().max(160).nullable().optional(),
  logoUrl: z.string().url().max(1000).nullable().optional().or(z.literal("")),
  // A hex colour like #1d4ed8.
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1d4ed8")
    .nullable()
    .optional()
    .or(z.literal("")),
  tagline: z.string().max(200).nullable().optional(),
});
