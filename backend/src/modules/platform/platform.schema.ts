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

// Support access (impersonation): a reason is MANDATORY and must be meaningful
// (audited justification for entering a tenant), enforced server-side.
export const impersonateSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(8, "A reason of at least 8 characters is required").max(500),
});

// --- Support user selector (search) ---
export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  institutionId: z.string().uuid().optional(),
  role: z.string().max(40).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// --- Institution directory (search / filter / paginate / sort) ---
const institutionFilterFields = {
  q: z.string().trim().max(200).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  type: z.enum(["school", "college"]).optional(),
  packageId: z.string().uuid().optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
};
const institutionSort = z
  .enum(["name", "code", "status", "createdAt", "students", "staff", "package"])
  .default("createdAt");
const sortOrder = z.enum(["asc", "desc"]).default("desc");

export const listInstitutionsQuerySchema = z.object({
  ...institutionFilterFields,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: institutionSort,
  order: sortOrder,
});

export const institutionExportQuerySchema = z.object({
  ...institutionFilterFields,
  sort: institutionSort,
  order: sortOrder,
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

// --- Cross-tenant audit viewer (search / filter / paginate / sort / export) ---
const auditFilterFields = {
  q: z.string().trim().max(200).optional(),
  institutionId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  targetType: z.string().max(40).optional(),
  ip: z.string().max(60).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
};
const auditSort = z.enum(["createdAt", "action", "actorEmail"]).default("createdAt");

export const platformAuditQuerySchema = z.object({
  ...auditFilterFields,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: auditSort,
  order: sortOrder,
});

export const auditExportQuerySchema = z.object({
  ...auditFilterFields,
  sort: auditSort,
  order: sortOrder,
  format: z.enum(["csv", "xlsx"]).default("csv"),
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

