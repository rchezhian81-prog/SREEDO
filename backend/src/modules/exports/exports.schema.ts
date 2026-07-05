import { z } from "zod";

/**
 * Super Admin K — Data Export Center validation.
 *
 * A FIXED set of platform export scopes + formats. "Sensitive" scopes carry
 * personal/security data and require a reason + approval before the artifact is
 * generated (enforced in the service). Filters are a permissive object validated +
 * applied server-side (always parameterised) per scope.
 */

export const EXPORT_SCOPES = [
  "institutions",
  "platform_admins",
  "tenant_users",
  "invoices",
  "subscriptions",
  "packages",
  "coupons",
  "payments",
  "audit_logs",
  "security_reports",
  "support_history",
  "backup_metadata",
  "documents_metadata",
  "students",
  "staff",
  "fees",
  "attendance",
  "exams",
  "portability_pack",
] as const;

/** Scopes that always require a reason + approval (personal/security/broad data). */
export const SENSITIVE_SCOPES: readonly (typeof EXPORT_SCOPES)[number][] = [
  "platform_admins",
  "tenant_users",
  "payments",
  "audit_logs",
  "security_reports",
  "support_history",
  "backup_metadata",
  "students",
  "staff",
  "portability_pack",
];

export const EXPORT_FORMATS = ["csv", "xlsx", "json", "zip"] as const;

export const EXPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;

export const APPROVAL_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
] as const;

export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

const isoDate = z.string().date();

/** Filters are validated per-scope in the service; kept permissive here (primitive
 *  values only — no nested objects — so they map cleanly to parameterised WHERE). */
const filters = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .default({});

const runTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "runTime must be HH:MM (24h)");

export const createExportSchema = z
  .object({
    name: z.string().trim().min(3, "An export name of at least 3 characters is required").max(160),
    scope: z.enum(EXPORT_SCOPES),
    format: z.enum(EXPORT_FORMATS).default("csv"),
    institutionId: z.string().uuid().optional(),
    filters,
    reason: z.string().trim().max(500).optional(),
    riskReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.scope !== "portability_pack" || Boolean(v.institutionId), {
    message: "A tenant (institutionId) is required for a portability pack",
    path: ["institutionId"],
  });

export const portabilityPackSchema = z.object({
  institutionId: z.string().uuid(),
  name: z.string().trim().min(3).max(160).optional(),
  format: z.literal("zip").default("zip"),
  reason: z.string().trim().min(8, "A reason of at least 8 characters is required").max(500),
  riskReason: z.string().trim().max(500).optional(),
});

export const listExportsQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  status: z.enum(EXPORT_STATUSES).optional(),
  scope: z.enum(EXPORT_SCOPES).optional(),
  format: z.enum(EXPORT_FORMATS).optional(),
  createdBy: z.string().uuid().optional(),
  sensitive: z.coerce.boolean().optional(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["createdAt", "status", "sizeBytes", "expiresAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/** An export download is high-risk — a reason (min 5) is always required + audited. */
export const downloadQuerySchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required for an export download").max(500),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(5).max(500).optional(),
});

export const archiveSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
});

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5, "A decision reason of at least 5 characters is required").max(500),
});

export const scheduleCreateSchema = z.object({
  name: z.string().trim().min(3).max(160),
  scope: z.enum(EXPORT_SCOPES),
  format: z.enum(EXPORT_FORMATS).default("csv"),
  institutionId: z.string().uuid().optional(),
  filters,
  frequency: z.enum(SCHEDULE_FREQUENCIES).default("daily"),
  runTime: runTime.default("03:00"),
  reason: z.string().trim().max(500).optional(),
});

export const scheduleUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(160).optional(),
    format: z.enum(EXPORT_FORMATS).optional(),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
    runTime: runTime.optional(),
    enabled: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No schedule fields to update" });

export const scheduleListQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const retentionUpdateSchema = z
  .object({
    defaultRetentionDays: z.number().int().min(1).max(365).optional(),
    sensitiveRetentionDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No retention fields to update" });
