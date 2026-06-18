import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: z.enum(["school", "college"]).optional(),
    isActive: z.boolean().optional(),
    contact: z
      .object({
        email: z.string().max(160).nullish(),
        phone: z.string().max(40).nullish(),
        address: z.string().max(400).nullish(),
      })
      .partial()
      .optional(),
    enabledModules: z.array(z.string().min(1).max(40)).optional(),
    featureFlags: z.record(z.boolean()).optional(),
    academicYearDefaults: z.record(z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const auditQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  module: z.string().max(40).optional(),
  action: z.string().max(10).optional(), // HTTP method (POST/PATCH/DELETE)
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
