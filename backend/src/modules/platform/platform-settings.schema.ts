import { z } from "zod";

/**
 * Validation for the global platform-settings surface (Super Admin N).
 * Every field is optional so callers can PATCH a single setting; `nullable`
 * fields accept null to clear an optional value. No secret is ever accepted or
 * stored here.
 */
export const updatePlatformSettingsSchema = z
  .object({
    platformName: z.string().trim().min(1).max(120),
    platformDisplayName: z.string().trim().max(120).nullable(),
    supportEmail: z.string().trim().email().max(160).nullable(),
    supportPhone: z.string().trim().max(40).nullable(),
    defaultCountry: z.string().trim().max(80).nullable(),
    defaultState: z.string().trim().max(80).nullable(),
    defaultTimezone: z.string().trim().min(1).max(60),
    defaultCurrency: z.string().trim().min(1).max(8),
    defaultLanguage: z.string().trim().min(2).max(10),
    academicYearFormat: z.string().trim().min(1).max(40),
    dateFormat: z.string().trim().min(1).max(40),
    timeFormat: z.enum(["12h", "24h"]),
    financialYearStartMonth: z.number().int().min(1).max(12),
    internalNotes: z.string().max(5000).nullable(),
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string().max(2000).nullable(),
    maintenanceStartsAt: z.string().trim().min(1).nullable(),
    maintenanceEndsAt: z.string().trim().min(1).nullable(),
    announcementActive: z.boolean(),
    announcementText: z.string().max(2000).nullable(),
    announcementVisibility: z.enum(["super_admin", "tenant_admins", "all_users"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one setting to update",
  });
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

const flagKey = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Key may contain letters, numbers, dot, dash and underscore");

export const featureFlagCreateSchema = z.object({
  key: flagKey,
  displayName: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  defaultValue: z.boolean().optional(),
  status: z.enum(["enabled", "disabled", "rollout"]).optional(),
  scope: z.enum(["global", "tenant", "package"]).optional(),
  rolloutPercentage: z.number().int().min(0).max(100).nullable().optional(),
  allowedTenants: z.array(z.string().uuid()).max(2000).optional(),
});
export type FeatureFlagCreateInput = z.infer<typeof featureFlagCreateSchema>;

// Key is immutable after creation (keeps the audit trail stable); everything
// else is editable.
export const featureFlagUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable(),
    defaultValue: z.boolean(),
    status: z.enum(["enabled", "disabled", "rollout"]),
    scope: z.enum(["global", "tenant", "package"]),
    rolloutPercentage: z.number().int().min(0).max(100).nullable(),
    allowedTenants: z.array(z.string().uuid()).max(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type FeatureFlagUpdateInput = z.infer<typeof featureFlagUpdateSchema>;

export const featureFlagStatusSchema = z.object({
  status: z.enum(["enabled", "disabled", "rollout"]),
  rolloutPercentage: z.number().int().min(0).max(100).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export const settingsHistoryQuerySchema = z.object({
  scope: z.enum(["all", "settings", "feature_flag"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const rollbackSchema = z.object({
  auditId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
