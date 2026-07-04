import { z } from "zod";

/**
 * Super Admin F — Audit Consolidation validation.
 *
 * One consolidated, governed view over the durable platform_audit_log. Category /
 * severity / result are DERIVED (see audit.service), so the taxonomy value lists
 * below are the single source of truth shared by the filter schemas AND the
 * /categories reference endpoint. Dates are ISO yyyy-mm-dd.
 */

/** The 16 consolidated categories, mapped from the action string in the service. */
export const AUDIT_CATEGORIES = [
  "Authentication",
  "Authorization/RBAC",
  "Platform Admin Users",
  "Tenant Management",
  "Billing/Package",
  "Invoice",
  "Subscription",
  "Settings",
  "Security Center",
  "Support Access",
  "Backup/Restore",
  "Data Export",
  "Communication",
  "Jobs/System",
  "API Token",
  "Payment Gateway",
] as const;

export const AUDIT_SEVERITIES = ["info", "warning", "high_risk", "critical"] as const;
export const AUDIT_RESULTS = ["success", "failed", "blocked"] as const;

const isoDate = z.string().date();
const sortOrder = z.enum(["asc", "desc"]).default("desc");
const auditSort = z.enum(["createdAt", "action", "actorEmail", "severity"]).default("createdAt");

/** The full consolidated filter set (list + export share it). `module` aliases
 *  `category`; the service coalesces them. Unknown category/module strings simply
 *  match no rows (the WHERE compares against the computed category). */
const filterFields = {
  q: z.string().trim().max(200).optional(),
  institutionId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  actorRole: z.string().trim().max(60).optional(),
  action: z.string().trim().max(120).optional(),
  targetType: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(200).optional(),
  ip: z.string().trim().max(64).optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  category: z.string().trim().max(60).optional(),
  module: z.string().trim().max(60).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
};

export const auditListQuerySchema = z.object({
  ...filterFields,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: auditSort,
  order: sortOrder,
});

export const auditExportQuerySchema = z.object({
  ...filterFields,
  sort: auditSort,
  order: sortOrder,
  format: z.enum(["csv", "xlsx"]).default("csv"),
  // Conditionally REQUIRED for broad / high-severity exports (enforced in the
  // route); always at least 5 chars when supplied.
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500).optional(),
});

export const auditSummaryQuerySchema = z.object({
  window: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const auditAlertsQuerySchema = auditSummaryQuerySchema;

// ---- Saved filters ----

export const savedFilterCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.unknown()).default({}),
  isShared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export const savedFilterUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters: z.record(z.unknown()).optional(),
    isShared: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// ---- Retention policy ----

export const retentionUpdateSchema = z.object({
  // 30 days .. 10 years, or null to mark the policy not configured. This is policy
  // VISIBILITY only — no endpoint ever deletes audit rows.
  retentionDays: z.number().int().min(30).max(3650).nullable(),
  archiveEnabled: z.boolean().default(false),
});
