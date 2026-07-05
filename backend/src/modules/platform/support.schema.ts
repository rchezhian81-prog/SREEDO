import { z } from "zod";

/**
 * Super Admin G — Support Access validation + static reference lists.
 *
 * The reason templates, module keys and scopes are a FIXED set (not tenant-
 * configurable), shared by the start schema, the `/templates` reference endpoint
 * and the scope-enforcement middleware's mental model.
 */

export const REASON_TEMPLATES = [
  "bug_investigation",
  "tenant_request",
  "billing_support",
  "data_correction",
  "training_demo",
  "technical_troubleshooting",
  "security_review",
  "other",
] as const;

/** Coarse module keys a module-limited session can be scoped to. */
export const SUPPORT_MODULES = [
  "overview",
  "students",
  "staff",
  "fees",
  "attendance",
  "exams",
  "communication",
  "reports",
  "documents",
  "billing",
  "settings",
] as const;

export const SUPPORT_SCOPES = ["read_only", "write_enabled", "module_limited"] as const;

export const SUPPORT_STATUSES = ["active", "ended", "expired", "revoked", "failed"] as const;

export const startSchema = z
  .object({
    userId: z.string().uuid(),
    reason: z.string().trim().min(8, "A reason of at least 8 characters is required").max(500),
    reasonTemplate: z.enum(REASON_TEMPLATES).optional(),
    scope: z.enum(SUPPORT_SCOPES).default("read_only"),
    modules: z.array(z.enum(SUPPORT_MODULES)).optional(),
    // 5 minutes .. 2 hours; default 30. The session row (not just the JWT) is the
    // authoritative, revocable source of truth.
    expiryMinutes: z.coerce.number().int().min(5).max(120).default(30),
    // Phase 2 (L): a write-enabled start MUST reference a matching approved
    // approval request. Ignored for read_only / module_limited scopes.
    approvalId: z.string().uuid().optional(),
  })
  .refine((v) => v.scope !== "module_limited" || (v.modules && v.modules.length > 0), {
    message: "Select at least one module for a module-limited session",
    path: ["modules"],
  });

export const revokeSchema = z.object({
  reason: z.string().trim().min(5, "A revoke reason of at least 5 characters is required").max(500),
});

export const revokeByOperatorSchema = z.object({
  operatorId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

export const revokeByTenantSchema = z.object({
  institutionId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});

const isoDate = z.string().date();

export const listQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  institutionId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  status: z.enum(SUPPORT_STATUSES).optional(),
  scope: z.enum(SUPPORT_SCOPES).optional(),
  reasonTemplate: z.enum(REASON_TEMPLATES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["createdAt", "status", "scope"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---- Phase 2 (J): Reports ----

/** The ten report datasets. Hyphenated keys are the `type` query values. */
export const SUPPORT_REPORT_TYPES = [
  "all",
  "active",
  "expired",
  "revoked",
  "tenant-wise",
  "operator-wise",
  "reason-wise",
  "scope-wise",
  "long-running",
  "high-risk",
] as const;

/** Shared filter set for reports + exports (mirrors the history list filters). */
const reportFilterFields = {
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  institutionId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  status: z.enum(SUPPORT_STATUSES).optional(),
  scope: z.enum(SUPPORT_SCOPES).optional(),
  reasonTemplate: z.enum(REASON_TEMPLATES).optional(),
};

export const reportsQuerySchema = z.object({
  type: z.enum(SUPPORT_REPORT_TYPES).default("all"),
  ...reportFilterFields,
});

// ---- Phase 2 (F/J): Exports ----

/** History export = the list filters + output format + optional governance reason
 *  (the route requires a reason for a broad — no dateFrom — export). */
export const exportQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  institutionId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  status: z.enum(SUPPORT_STATUSES).optional(),
  scope: z.enum(SUPPORT_SCOPES).optional(),
  reasonTemplate: z.enum(REASON_TEMPLATES).optional(),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500).optional(),
});

export const reportsExportQuerySchema = reportsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500).optional(),
});

// ---- Phase 2 (L): Approval workflow ----

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

/** Request approval for a would-be high-risk session (the start params + why). */
export const approvalCreateSchema = z
  .object({
    userId: z.string().uuid(),
    reason: z.string().trim().min(8, "A reason of at least 8 characters is required").max(500),
    reasonTemplate: z.enum(REASON_TEMPLATES).optional(),
    scope: z.enum(SUPPORT_SCOPES).default("write_enabled"),
    modules: z.array(z.enum(SUPPORT_MODULES)).optional(),
    expiryMinutes: z.coerce.number().int().min(5).max(120).default(30),
    riskReason: z.string().trim().min(5, "A risk justification of at least 5 characters is required").max(500),
  })
  .refine((v) => v.scope !== "module_limited" || (v.modules && v.modules.length > 0), {
    message: "Select at least one module for a module-limited session",
    path: ["modules"],
  });

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5, "A decision reason of at least 5 characters is required").max(500),
});

export const approvalListQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
