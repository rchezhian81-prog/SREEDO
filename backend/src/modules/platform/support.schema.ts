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
