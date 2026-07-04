import { z } from "zod";

/**
 * Super Admin P — Security & Compliance Center validation.
 *
 * Every mutating input is validated here; sensitive actions carry an audited
 * reason (min 5 chars). Dates are ISO yyyy-mm-dd; windows are coarse presets the
 * dashboard/report filters share.
 */

const roleKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{2,48}$/, "Invalid role key");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

/** Coarse time window shared by the dashboard, feed and reports. */
export const windowEnum = z.enum(["today", "7d", "30d", "custom"]).default("7d");

export const dashboardQuerySchema = z.object({
  window: windowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---- 2FA policy ----

export const twoFaPolicySchema = z.object({
  roleKey,
  require2fa: z.boolean(),
  graceUntil: isoDate.nullish(),
  reason: z.string().trim().min(5).optional(),
});

export const twoFaComplianceQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "compliant", "non_compliant", "grace"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---- Sessions ----

export const sessionsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: roleKey.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const revokeRoleSchema = z.object({
  roleKey,
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

// ---- Login history / failed-login monitoring ----

export const loginHistoryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  outcome: z.enum(["success", "failed"]).optional(),
  ip: z.string().trim().max(64).optional(),
  scope: z.enum(["platform", "all"]).default("platform"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const failedSummaryQuerySchema = z.object({
  window: windowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  by: z.enum(["email", "ip", "day"]).default("email"),
});

// ---- Password policy ----

export const passwordPolicySchema = z.object({
  minLength: z.coerce.number().int().min(8).max(128),
  requireComplexity: z.boolean(),
  expiryDays: z.coerce.number().int().min(0).max(3650).nullish(),
  reason: z.string().trim().min(5).optional(),
});

// ---- IP allowlist ----

/** Accepts an IPv4/IPv6 address or CIDR (loose; exact match enforced in-service). */
const cidr = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[12][0-9]|3[0-2]))?$|^[0-9a-fA-F:]+(\/[0-9]{1,3})?$/,
    "Enter a valid IPv4/IPv6 address or CIDR (e.g. 203.0.113.10 or 203.0.113.0/24)"
  );

export const ipAllowlistAddSchema = z.object({
  cidr,
  label: z.string().trim().max(120).optional(),
});

export const ipAllowlistToggleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(5).optional(),
});

// ---- API tokens ----

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  expiresInDays: z.coerce.number().int().min(1).max(3650).nullish(),
});

// ---- High-risk feed ----

export const highRiskQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z
    .enum(["all", "rbac", "admins", "impersonation", "backups", "billing", "settings", "exports"])
    .default("all"),
  actorId: z.string().uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---- Compliance reports ----

export const complianceReportEnum = z.enum([
  "platform_admin_access",
  "rbac_permissions",
  "twofa_compliance",
  "login_security",
  "support_access",
  "audit_activity",
  "sessions",
  "data_export",
  "backup_restore",
]);

export const complianceReportQuerySchema = z.object({
  report: complianceReportEnum,
  window: windowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  role: roleKey.optional(),
  status: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export const reportExportQuerySchema = z.object({
  report: complianceReportEnum,
  format: z.enum(["csv", "xlsx"]).default("csv"),
  window: windowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  role: roleKey.optional(),
  status: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});
