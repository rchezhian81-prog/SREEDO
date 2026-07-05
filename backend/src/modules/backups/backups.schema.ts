import { z } from "zod";

export const BACKUP_STATUSES = ["pending", "running", "success", "failed", "archived"] as const;
export const BACKUP_SCOPES = ["global", "institution"] as const;
export const BACKUP_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export const BACKUP_TRIGGERS = ["manual", "scheduled", "pre_deploy", "pre_restore"] as const;

export const RESTORE_SCOPES = ["full", "database", "files", "config"] as const;
export const RESTORE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
  "executed",
  "failed",
] as const;

/** Trigger a backup. Institution-scoped backups require an institution id. */
export const createBackupSchema = z
  .object({
    scope: z.enum(BACKUP_SCOPES).default("global"),
    institutionId: z.string().uuid().optional(),
    reason: z.string().trim().max(500).optional(),
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
 * Legacy direct-restore body (kept for the internal restore core). Restores are
 * destructive: they always require explicit confirmation, and in production they
 * additionally require `force`. Direct one-click restore via the API is REMOVED —
 * production restores must go through the request → approve → execute workflow.
 */
export const restoreSchema = z.object({
  confirm: z.boolean(),
  force: z.boolean().default(false),
});

const runTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "runTime must be HH:MM (24h)");

/** Retention + automatic-schedule + offsite/encryption/alert settings.
 *  retentionCount null disables retention (old backups are never archived).
 *  All fields optional (partial PATCH). */
export const updateSettingsSchema = z
  .object({
    retentionCount: z.number().int().min(1).max(1000).nullable().optional(),
    retentionMinKeep: z.number().int().min(1).max(50).optional(),
    scheduleEnabled: z.boolean().optional(),
    scheduleFrequency: z.enum(BACKUP_FREQUENCIES).optional(),
    scheduleRunTime: runTime.optional(),
    offsiteEnabled: z.boolean().optional(),
    encryptionEnabled: z.boolean().optional(),
    failureAlertEnabled: z.boolean().optional(),
    // Comma / newline separated list of platform-admin emails (else all super admins).
    alertEmails: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No settings to update" });

/** Simple (legacy) list — capped, no pagination. */
export const listBackupsQuerySchema = z.object({
  scope: z.enum(BACKUP_SCOPES).optional(),
  status: z.enum(BACKUP_STATUSES).optional(),
  institutionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const isoDate = z.string().date();

/** Paginated, filterable backup run history. */
export const historyQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(BACKUP_STATUSES).optional(),
  scope: z.enum(BACKUP_SCOPES).optional(),
  trigger: z.enum(BACKUP_TRIGGERS).optional(),
  createdBy: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["createdAt", "status", "sizeBytes"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** History export = the history filters + output format + optional governance reason. */
export const exportQuerySchema = historyQuerySchema
  .omit({ page: true, pageSize: true, sort: true, order: true })
  .extend({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    reason: z.string().trim().min(5).max(500).optional(),
  });

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/** A backup download is high-risk — a reason (min 5) is always required + audited. */
export const downloadQuerySchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required for a backup download").max(500),
});

/** Archive (soft-delete) a backup artifact. Reason required; override needed to
 *  archive the latest successful backup / a rollback-window backup. */
export const archiveSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
  override: z.boolean().default(false),
});

// ---- Restore approval workflow ----

/** Raise a restore request for a backup (starts the approval workflow). */
export const restoreRequestSchema = z.object({
  scope: z.enum(RESTORE_SCOPES).default("full"),
  reason: z.string().trim().min(8, "A reason of at least 8 characters is required").max(500),
  riskReason: z.string().trim().min(5).max(500).optional(),
});

export const restoreDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5, "A decision reason of at least 5 characters is required").max(500),
});

export const restoreCancelSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
});

/** Execute an approved restore — typed confirmation + reason; force in production. */
export const restoreExecuteSchema = z.object({
  confirmText: z.string().trim().min(1),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
  force: z.boolean().default(false),
});

export const restoreListQuerySchema = z.object({
  status: z.enum(RESTORE_STATUSES).optional(),
  backupId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Update the in-app disaster-recovery guide (plain operational text only). */
export const drGuideUpdateSchema = z
  .object({
    policySummary: z.string().max(5000).nullable().optional(),
    restoreProcess: z.string().max(5000).nullable().optional(),
    approvalProcess: z.string().max(5000).nullable().optional(),
    emergencyInstructions: z.string().max(5000).nullable().optional(),
    preRestoreChecklist: z.string().max(5000).nullable().optional(),
    postRestoreChecklist: z.string().max(5000).nullable().optional(),
    rollbackGuide: z.string().max(5000).nullable().optional(),
    ownerName: z.string().max(200).nullable().optional(),
    ownerContact: z.string().max(200).nullable().optional(),
    sopLink: z.string().url().max(500).nullable().optional().or(z.literal("")),
    markReviewed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No guide fields to update" });
