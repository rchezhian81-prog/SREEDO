import { z } from "zod";

// Super Admin I — Platform Admin User Management. All inputs validated here; the
// service enforces the owner-safety rules on top.

export const PLATFORM_ROLES = [
  "owner",
  "platform_admin",
  "support_operator",
  "billing_admin",
  "auditor",
  "technical_admin",
] as const;

const platformRole = z.enum(PLATFORM_ROLES);
const reason = z.string().trim().min(5, "A reason of at least 5 characters is required").max(500);

export const listAdminsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  platformRole: platformRole.optional(),
  status: z.enum(["active", "disabled", "locked"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["fullName", "email", "platformRole", "createdAt", "lastLoginAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  platformRole,
  fullName: z.string().trim().min(1).max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  fullName: z.string().trim().min(1).max(200),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

/** Enable/disable/lock/unlock/reset-2FA all require an audited reason. */
export const reasonSchema = z.object({ reason });

export const assignRoleSchema = z.object({
  platformRole,
  reason,
});

export const setActiveSchema = z.object({
  isActive: z.boolean(),
  reason,
});

export const securityConfigSchema = z.object({
  force2faForPlatform: z.boolean(),
  reason: reason.optional(),
});

export const revokeSessionSchema = z.object({
  reason: reason.optional(),
});

export const loginHistoryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  outcome: z.enum(["success", "failed"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
