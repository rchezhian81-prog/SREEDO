import { z } from "zod";

/**
 * Super Admin O — Communication Admin request schemas.
 *
 * Enum sets mirror the CHECK constraints in migration 0102_communication_admin.
 * Every list/query schema coerces + bounds pagination (pageSize ≤ 200); every
 * mutation validates its free-text; a ≥5-char reason is required for broad
 * broadcasts, exports and external test sends. Template bodies are length-bounded.
 */

const isoDate = z.string().date();

// ---- Enum sets (mirror the migration) --------------------------------------

export const TEMPLATE_CATEGORIES = [
  "onboarding",
  "security",
  "billing",
  "subscription",
  "support",
  "backup",
  "export",
  "platform",
  "broadcast",
  "general",
] as const;

export const TEMPLATE_STATUSES = ["draft", "active", "disabled"] as const;

export const TRIGGER_SOURCES = [
  "invoice",
  "subscription",
  "support",
  "security",
  "backup",
  "export",
  "platform_admin",
  "manual_test",
  "broadcast",
  "system",
] as const;

export const DELIVERY_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "skipped",
] as const;

export const BROADCAST_AUDIENCES = [
  "platform_admins",
  "tenant_admins",
  "specific_tenant",
  "institution_type",
  "all_tenants",
] as const;

export const BROADCAST_CHANNELS = ["email", "in_app", "both"] as const;

export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;

export const PREFERENCE_CATEGORIES = [
  "invoice",
  "subscription",
  "support",
  "security",
  "backup",
  "export",
  "platform_admin",
  "broadcast",
] as const;

export const INSTITUTION_TYPES = ["school", "college"] as const;

// The template variable ALLOWLIST — a {{var}} is only ever resolved when its name
// is one of these; anything else is left visible + flagged (never silently), and
// no variable may resolve to a secret.
export const TEMPLATE_VARS = [
  "tenantName",
  "tenantCode",
  "userName",
  "email",
  "invoiceNumber",
  "invoiceAmount",
  "invoiceDueDate",
  "paymentLink",
  "subscriptionPackage",
  "subscriptionExpiry",
  "supportScope",
  "securitySummary",
  "exportName",
  "exportStatus",
  "backupStatus",
  "platformName",
  "supportEmail",
  "appUrl",
] as const;

const reasonRequired = z
  .string()
  .trim()
  .min(5, "A reason of at least 5 characters is required")
  .max(500);
const reasonOptional = z.string().trim().max(500).optional();

const sampleContext = z.record(z.string().max(80), z.string().max(2000)).optional();

// ---- Dashboard / window ----------------------------------------------------

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d", "custom"]).default("today"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---- Provider / test send --------------------------------------------------

export const providerTestSchema = z.object({
  templateKey: z.string().trim().max(120).optional(),
  to: z.string().trim().email().max(320),
  sampleContext,
  reason: reasonOptional,
});

// The /:key/test route takes the key from the path.
export const templateTestSchema = z.object({
  to: z.string().trim().email().max(320),
  sampleContext,
  reason: reasonOptional,
});

// ---- Templates -------------------------------------------------------------

export const templateListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  builtin: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const templateKey = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9_]+$/, "Key must be lowercase letters, digits and underscores");
const subject = z.string().trim().max(500);
const bodyText = z.string().max(20000);
const bodyHtml = z.string().max(50000).nullable().optional();

export const templateCreateSchema = z.object({
  key: templateKey,
  name: z.string().trim().min(2).max(200),
  category: z.enum(TEMPLATE_CATEGORIES).default("general"),
  subject,
  bodyText,
  bodyHtml,
  description: z.string().trim().max(500).optional(),
  status: z.enum(TEMPLATE_STATUSES).default("active"),
});

export const templateUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    category: z.enum(TEMPLATE_CATEGORIES).optional(),
    subject: subject.optional(),
    bodyText: bodyText.optional(),
    bodyHtml,
    description: z.string().trim().max(500).nullable().optional(),
    changeNote: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const templatePublishSchema = z.object({
  status: z.enum(TEMPLATE_STATUSES),
});

export const templateRestoreSchema = z.object({
  version: z.coerce.number().int().min(1),
  changeNote: z.string().trim().max(500).optional(),
});

export const templatePreviewSchema = z.object({
  sampleContext,
  // Optional overrides to preview UNSAVED edits without persisting them.
  subject: subject.optional(),
  bodyText: bodyText.optional(),
  bodyHtml,
});

// ---- Deliveries ------------------------------------------------------------

const DELIVERY_SORTS = ["createdAt", "status", "triggerSource", "template"] as const;

export const deliveryListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
  template: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  tenant: z.string().uuid().optional(),
  triggerSource: z.enum(TRIGGER_SOURCES).optional(),
  recipient: z.string().trim().max(320).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(DELIVERY_SORTS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const deliveryExportQuerySchema = deliveryListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    reason: reasonRequired,
  });

export const deliveryRetrySchema = z.object({ reason: reasonOptional });

// ---- Broadcasts ------------------------------------------------------------

const audienceFilter = z
  .object({
    institutionId: z.string().uuid().optional(),
    institutionType: z.enum(INSTITUTION_TYPES).optional(),
  })
  .optional();

export const broadcastListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(BROADCAST_STATUSES).optional(),
  audience: z.enum(BROADCAST_AUDIENCES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const broadcastCreateSchema = z.object({
  title: z.string().trim().min(2).max(300),
  bodyText: z.string().max(20000).default(""),
  bodyHtml,
  audience: z.enum(BROADCAST_AUDIENCES).default("platform_admins"),
  audienceFilter,
  channel: z.enum(BROADCAST_CHANNELS).default("email"),
});

export const broadcastUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(300).optional(),
    bodyText: z.string().max(20000).optional(),
    bodyHtml,
    audience: z.enum(BROADCAST_AUDIENCES).optional(),
    audienceFilter,
    channel: z.enum(BROADCAST_CHANNELS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const broadcastPreviewAudienceSchema = z.object({
  audience: z.enum(BROADCAST_AUDIENCES).optional(),
  audienceFilter,
});

export const broadcastSendSchema = z.object({ reason: reasonOptional });

export const broadcastScheduleSchema = z.object({
  scheduledAt: z.string().datetime({ message: "scheduledAt must be an ISO 8601 datetime" }),
  reason: reasonOptional,
});

export const broadcastCancelSchema = z.object({ reason: reasonOptional });

// ---- Preferences -----------------------------------------------------------

export const preferencesUpdateSchema = z.object({
  categories: z
    .object(Object.fromEntries(PREFERENCE_CATEGORIES.map((k) => [k, z.boolean().optional()])) as Record<
      (typeof PREFERENCE_CATEGORIES)[number],
      z.ZodOptional<z.ZodBoolean>
    >)
    .refine((v) => Object.keys(v).length > 0, { message: "At least one category is required" }),
});

// ---- Reports ---------------------------------------------------------------

export const reportsQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d", "custom"]).default("30d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  triggerSource: z.enum(TRIGGER_SOURCES).optional(),
  category: z.string().trim().max(60).optional(),
  tenant: z.string().uuid().optional(),
});

export const reportsExportQuerySchema = reportsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: reasonRequired,
});
