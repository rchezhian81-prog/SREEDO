import { z } from "zod";

// Super Admin D — subscription management input validation.
// Every list/report accepts the same filter vocabulary; high-risk actions
// require a human-readable reason (audited).

export const SUB_STATUSES = ["active", "trialing", "suspended", "cancelled", "expired"] as const;
export const BILLING_CYCLES = ["monthly", "quarterly", "half_yearly", "annual"] as const;
export const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
export const PAYMENT_STATUSES = ["paid", "outstanding", "overdue", "none"] as const;
export const NOTE_TYPES = ["renewal", "billing", "support", "cancellation", "upgrade", "general"] as const;

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const reason = (min: number) => z.string().trim().min(min, `a reason of at least ${min} characters is required`).max(500);
const optReason = z.string().trim().max(500).optional();

/** Shared filter vocabulary for list / calendar / reports / export. */
export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(SUB_STATUSES).optional(),
  packageId: z.string().uuid().optional(),
  institutionType: z.enum(INSTITUTION_TYPES).optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  startFrom: isoDate.optional(),
  startTo: isoDate.optional(),
  endFrom: isoDate.optional(),
  endTo: isoDate.optional(),
  renewFrom: isoDate.optional(),
  renewTo: isoDate.optional(),
  trialFrom: isoDate.optional(),
  trialTo: isoDate.optional(),
  sort: z
    .enum(["institution", "package", "status", "start", "expiry", "renewal", "outstanding"])
    .default("institution"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const exportQuerySchema = listQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

export const summaryQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  soonDays: z.coerce.number().int().min(1).max(120).default(30),
});

export const calendarQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(SUB_STATUSES).optional(),
  packageId: z.string().uuid().optional(),
  institutionType: z.enum(INSTITUTION_TYPES).optional(),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
});

export const REPORT_KEYS = [
  "active", "trial", "expiring", "expired", "suspended", "cancelled", "grace",
  "package_wise", "institution_type_wise", "renewal_due", "overdue",
  "mrr", "arr", "churn", "trial_conversion", "upgrade_downgrade",
] as const;

export const reportQuerySchema = listQuerySchema
  .omit({ sort: true, order: true, page: true, pageSize: true })
  .extend({
    key: z.enum(REPORT_KEYS),
    months: z.coerce.number().int().min(1).max(24).default(12),
    format: z.enum(["json", "csv", "xlsx"]).default("json"),
    soonDays: z.coerce.number().int().min(1).max(120).default(30),
  });

// --- Lifecycle config (DB-backed singleton) ---
export const configUpdateSchema = z
  .object({
    trialDays: z.number().int().min(0).max(365).optional(),
    graceDays: z.number().int().min(0).max(180).optional(),
    renewalReminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    expiryReminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    autoExpireEnabled: z.boolean().optional(),
    autoSuspendEnabled: z.boolean().optional(),
    billingOverdueSuspendEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No config fields to update" });

// --- Manual actions (reason required on high-risk) ---
export const extendSchema = z.object({ endsAt: isoDate, reason: optReason });
export const renewSchema = z.object({
  billingCycle: z.enum(BILLING_CYCLES).optional(), // else derive from package
  periods: z.coerce.number().int().min(1).max(60).default(1),
  packageId: z.string().uuid().optional(), // renew onto a different package
  createInvoice: z.boolean().default(false),
  reason: optReason,
});
export const changePackageSchema = z.object({
  packageId: z.string().uuid(),
  effectiveDate: isoDate.optional(),
  reason: reason(5),
});
export const cancelSchema = z.object({ reason: reason(5), effectiveDate: isoDate.optional() });
export const suspendSchema = z.object({ reason: reason(5), suspendTenant: z.boolean().default(false) });
export const reactivateSchema = z.object({ reason: optReason, endsAt: isoDate.optional(), reactivateTenant: z.boolean().default(false) });
export const markExpiredSchema = z.object({ reason: reason(5) });

// --- Notes ---
export const noteCreateSchema = z.object({
  noteType: z.enum(NOTE_TYPES).default("general"),
  body: z.string().trim().min(1).max(4000),
  followUpDate: isoDate.optional(),
  owner: z.string().trim().max(120).optional(),
});
export const noteUpdateSchema = z
  .object({
    noteType: z.enum(NOTE_TYPES).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    followUpDate: isoDate.nullable().optional(),
    owner: z.string().trim().max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No note fields to update" });

export const reminderSchema = z.object({ reason: optReason });
