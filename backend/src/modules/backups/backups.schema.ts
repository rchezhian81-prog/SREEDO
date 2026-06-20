import { z } from "zod";

export const BACKUP_STATUSES = ["pending", "running", "success", "failed"] as const;
export const BACKUP_SCOPES = ["global", "institution"] as const;
export const BACKUP_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

/** Trigger a backup. Institution-scoped backups require an institution id. */
export const createBackupSchema = z
  .object({
    scope: z.enum(BACKUP_SCOPES).default("global"),
    institutionId: z.string().uuid().optional(),
  })
  .refine((v) => v.scope === "global" || Boolean(v.institutionId), {
    message: "institutionId is required for an institution-scoped backup",
    path: ["institutionId"],
  })
  .refine((v) => v.scope === "institution" || !v.institutionId, {
    message: "institutionId is only valid for an institution-scoped backup",
    path: ["institutionId"],
  });

/**
 * Restore is destructive: it always requires explicit confirmation, and in
 * production it additionally requires `force` so it can never happen by accident.
 */
export const restoreSchema = z.object({
  confirm: z.boolean(),
  force: z.boolean().default(false),
});

const runTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "runTime must be HH:MM (24h)");

/** Retention + automatic-schedule settings. retentionCount null disables
 *  retention (old backups are never deleted). All fields optional (partial PUT). */
export const updateSettingsSchema = z
  .object({
    retentionCount: z.number().int().min(1).max(1000).nullable().optional(),
    scheduleEnabled: z.boolean().optional(),
    scheduleFrequency: z.enum(BACKUP_FREQUENCIES).optional(),
    scheduleRunTime: runTime.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No settings to update" });

export const listBackupsQuerySchema = z.object({
  scope: z.enum(BACKUP_SCOPES).optional(),
  status: z.enum(BACKUP_STATUSES).optional(),
  institutionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
