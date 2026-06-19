import { z } from "zod";

// Institution create/update + subscription assignment reuse the existing
// super-admin schemas so the validation never drifts.
export {
  assignSubscriptionSchema,
  createInstitutionSchema,
  updateInstitutionSchema,
} from "../superadmin/superadmin.schema";

/** Per-institution limit overrides (stored in institutions.settings.limits). */
export const setLimitsSchema = z
  .object({
    maxStudents: z.number().int().min(0).nullable().optional(),
    maxStaff: z.number().int().min(0).nullable().optional(),
    maxBranches: z.number().int().min(0).nullable().optional(),
    storageLimitMb: z.number().int().min(0).nullable().optional(),
    reportsQuota: z.number().int().min(0).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No limits to update" });

export const suspendSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const impersonateSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const platformAuditQuerySchema = z.object({
  institutionId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  targetType: z.string().max(40).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// --- RBAC console ---

/** Roles whose grants may be edited (super_admin is protected for platform:*). */
export const MANAGEABLE_ROLES = [
  "super_admin",
  "admin",
  "teacher",
  "accountant",
  "student",
  "parent",
] as const;

export const roleParamSchema = z.enum(MANAGEABLE_ROLES);

export const grantPermissionSchema = z.object({
  permissionKey: z.string().min(1).max(100),
  reason: z.string().max(500).optional(),
});

