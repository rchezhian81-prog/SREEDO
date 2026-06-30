import { z } from "zod";

export const createInstitutionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may use letters, digits, - and _")
    .transform((value) => value.toUpperCase()),
  type: z.enum(["school", "college"]).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateInstitutionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["school", "college"]).optional(),
  isActive: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  timezone: z.string().max(60).optional(),
});

export const updateBranchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  timezone: z.string().max(60).optional(),
  isActive: z.boolean().optional(),
});

// --- Packages / Plans -------------------------------------------------------
// billing_cycle is a stored label (no lifecycle/invoice date math branches on it).
export const PACKAGE_STATUSES = ["active", "draft", "deprecated", "archived"] as const;
export const PACKAGE_VISIBILITIES = ["public", "internal", "hidden"] as const;
export const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
export const BILLING_CYCLES = ["monthly", "quarterly", "half_yearly", "annual"] as const;

const limitMap = z.record(z.number().int().nonnegative().nullable());

const packageBase = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  currency: z.string().trim().min(1).max(8),
  price: z.number().nonnegative(),
  setupFee: z.number().nonnegative(),
  billingCycle: z.enum(BILLING_CYCLES),
  status: z.enum(PACKAGE_STATUSES),
  visibility: z.enum(PACKAGE_VISIBILITIES),
  badge: z.string().max(40).nullable(),
  displayOrder: z.number().int(),
  applicableTypes: z.array(z.enum(INSTITUTION_TYPES)).max(5),
  maxStudents: z.number().int().nonnegative().nullable(),
  maxStaff: z.number().int().nonnegative().nullable(),
  limits: limitMap,
  features: z.record(z.unknown()),
  taxPercent: z.number().nonnegative().max(100),
  invoiceDueDays: z.number().int().nonnegative().nullable(),
  paymentTerms: z.string().max(500).nullable(),
  sacHsn: z.string().max(40).nullable(),
  taxCategory: z.string().max(40).nullable(),
  billingStartRule: z.enum(["immediate", "after_trial", "custom"]),
  autoRenew: z.boolean(),
  graceDays: z.number().int().nonnegative().nullable(),
  isTrial: z.boolean(),
  trialDays: z.number().int().nonnegative().nullable(),
  trialExpiryBehavior: z.enum(["expire", "suspend", "convert_manual"]).nullable(),
  trialConversionPackageId: z.string().uuid().nullable(),
});

// Create: name required, everything else optional (backward compatible with the
// old 5-field create). Status changes after creation go through the dedicated
// status endpoint (with impact + reason).
export const createPackageSchema = packageBase.partial().required({ name: true });

// status (and therefore is_active) is changed only via the dedicated /status
// endpoint, so it is intentionally omitted here to keep status ↔ is_active in lock-step.
export const updatePackageSchema = packageBase
  .omit({ status: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const packageStatusSchema = z.object({
  status: z.enum(PACKAGE_STATUSES),
  reason: z.string().max(500).optional(),
});

export const duplicatePackageSchema = z.object({
  name: z.string().min(1).max(120),
});

export const packageListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(PACKAGE_STATUSES).optional(),
  institutionType: z.enum(INSTITUTION_TYPES).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  visibility: z.enum(PACKAGE_VISIBILITIES).optional(),
  sort: z.enum(["name", "price", "displayOrder", "status", "createdAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const packageExportQuerySchema = packageListQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

export const packageUsageQuerySchema = z.object({
  packageId: z.string().uuid().optional(),
  institutionType: z.enum(INSTITUTION_TYPES).optional(),
  status: z.string().max(20).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  format: z.enum(["csv", "xlsx"]).optional(),
});

export const packageCompareQuerySchema = z.object({
  // comma-separated package UUIDs → validated string[] (bad UUID ⇒ 400, not a DB 500)
  ids: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(8)),
});

export const assignSubscriptionSchema = z.object({
  packageId: z.string().uuid(),
  status: z.enum(["active", "trialing", "suspended", "cancelled"]).optional(),
  startsAt: z.string().date().optional(),
  endsAt: z.string().date().nullable().optional(),
  // super-admin override to assign a package to an unsupported institution type
  override: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});
