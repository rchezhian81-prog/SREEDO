import { z } from "zod";

/**
 * Tenant / Institution Management schemas (one common, type-driven module).
 * institutionType (5 values) drives config; the structural `type` (school/college)
 * is derived in the service and never set directly here.
 */

export const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
export const LIFECYCLE_STATUSES = ["draft", "trial", "active", "suspended", "expired", "archived", "closed"] as const;
export const DOCUMENT_CATEGORIES = ["registration", "trust_company", "gst", "pan_tan", "agreement", "authorization", "logo", "other"] as const;
export const MODULE_KEYS = [
  "admissions", "students", "staff", "attendance", "fees", "exams", "transport",
  "hostel", "library", "inventory", "communication", "reports", "documents",
  "certificates", "timetable", "payroll", "hr",
] as const;

const optStr = (max = 200) => z.string().trim().max(max).nullable().optional();

// Profile fields shared by create (optional) and update (nullable to clear).
const profileFields = {
  legalName: optStr(200),
  shortName: optStr(120),
  address: optStr(1000),
  city: optStr(120),
  state: optStr(120),
  country: optStr(120),
  pincode: optStr(20),
  phone: optStr(40),
  email: z.string().trim().email().max(200).nullable().optional(),
  website: optStr(200),
  academicYear: optStr(40),
  timezone: optStr(60),
  currency: z.string().trim().min(1).max(8).nullable().optional(),
  language: optStr(40),
  notes: optStr(2000),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug may use lowercase letters, digits and hyphens")
    .min(2)
    .max(63)
    .nullable()
    .optional(),
};

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may use letters, digits, - and _")
    .transform((v) => v.toUpperCase()),
  institutionType: z.enum(INSTITUTION_TYPES).default("school"),
  ...profileFields,
  // Optional primary admin created during onboarding.
  primaryAdmin: z
    .object({ fullName: z.string().trim().min(1).max(200), email: z.string().trim().email().max(200) })
    .optional(),
});

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    institutionType: z.enum(INSTITUTION_TYPES).optional(),
    ...profileFields,
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Lifecycle transitions. suspend/archive require a reason; others optional.
export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const optionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

// School-specific settings (institution_type = school). All optional.
const schoolSettingsSchema = z
  .object({
    classesEnabled: z.boolean(),
    sectionsEnabled: z.boolean(),
    houseSystem: z.boolean(),
    classTeacher: z.boolean(),
    rollNumberFormat: z.string().max(60),
    admissionNumberFormat: z.string().max(60),
    examPattern: z.enum(["term", "quarterly", "half_yearly", "annual"]),
    attendanceMode: z.enum(["daily", "period"]),
    feeStructureMode: z.enum(["class", "section"]),
    parentCommunication: z.boolean(),
  })
  .partial();

// College/university/coaching settings (institution_type != school). All optional.
const collegeSettingsSchema = z
  .object({
    departmentsEnabled: z.boolean(),
    coursesEnabled: z.boolean(),
    batchesEnabled: z.boolean(),
    semesterSystem: z.enum(["semester", "year"]),
    sectionGroupEnabled: z.boolean(),
    subjectMappingMode: z.enum(["subject", "paper"]),
    creditSystem: z.boolean(),
    internalMarks: z.boolean(),
    universityExam: z.boolean(),
    attendanceMode: z.enum(["subject", "daily"]),
    feeStructureMode: z.enum(["course", "semester"]),
    enrollmentNumberFormat: z.string().max(60),
  })
  .partial();

// Type-based config persisted in institutions.settings (jsonb).
export const settingsSchema = z
  .object({
    academicStructure: z.record(z.unknown()),
    enabledModules: z.record(z.boolean()),
    schoolSettings: schoolSettingsSchema,
    collegeSettings: collegeSettingsSchema,
    communication: z
      .object({
        emailSenderName: z.string().max(120).nullable().optional(),
        replyToEmail: z.string().email().max(200).nullable().optional(),
        smsSenderId: z.string().max(20).nullable().optional(),
        notifyEmail: z.boolean().optional(),
        notifySms: z.boolean().optional(),
        whatsappEnabled: z.boolean().optional(),
      })
      .partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No settings to update" });

// Onboarding: mark a checklist step done/undone, or complete the whole flow.
export const onboardingStepSchema = z.object({
  step: z.string().trim().min(1).max(60),
  done: z.boolean(),
});

export const complianceSchema = z
  .object({
    termsAccepted: z.boolean().optional(),
    agreementSigned: z.boolean().optional(),
    dataProcessingConsent: z.boolean().optional(),
    kycStatus: z.enum(["pending", "verified", "rejected"]).optional(),
    approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
    approvalRemarks: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No compliance fields to update" });

// Lightweight CRM fields (account owner + last-contacted) on the institution row.
export const crmSchema = z
  .object({
    accountManager: z.string().trim().max(200).nullable().optional(),
    lastContactedAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No CRM fields to update" });

// Complete onboarding; `override` lets a super-admin activate despite missing steps.
export const completeOnboardingSchema = z
  .object({ override: z.boolean().optional() })
  .optional();

// Tenant document metadata (the file itself arrives as multipart `file`).
export const documentMetaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES).default("other"),
});
export const documentVerifySchema = z.object({
  status: z.enum(["pending", "verified", "rejected"]),
  remarks: z.string().trim().max(1000).nullable().optional(),
});

// Per-tenant branding (mirrors institution_branding; super-admin write path).
export const brandingSchema = z
  .object({
    displayName: z.string().trim().max(160).nullable().optional(),
    logoUrl: z.string().trim().url().max(1000).nullable().optional(),
    primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb hex colour").nullable().optional(),
    tagline: z.string().trim().max(200).nullable().optional(),
    letterhead: z.string().trim().max(2000).nullable().optional(),
    footer: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No branding fields to update" });

export const primaryAdminSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
});

export const noteSchema = z.object({
  noteType: z.enum(["sales", "support", "billing", "technical", "general"]).default("general"),
  body: z.string().trim().min(1).max(4000),
  followUpDate: z.string().date().nullable().optional(),
});
export const updateNoteSchema = z
  .object({
    noteType: z.enum(["sales", "support", "billing", "technical", "general"]).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    followUpDate: z.string().date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Tenant directory list (extends the institution list with type + lifecycle filters).
export const tenantListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  institutionType: z.enum(INSTITUTION_TYPES).optional(),
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  type: z.enum(["school", "college"]).optional(),
  package: z.string().trim().max(200).optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["name", "code", "status", "institutionType", "createdAt", "students", "staff"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const tenantExportQuerySchema = tenantListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(["csv", "xlsx"]).default("csv") });

// Bulk lifecycle across selected tenants (each transition still goes through the
// per-tenant guard — suspend/archive/close require a reason).
export const bulkLifecycleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(LIFECYCLE_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

// Full tenant user directory filters.
export const tenantUsersQuerySchema = z.object({
  role: z.enum(["admin", "teacher", "accountant", "student", "parent"]).optional(),
  status: z.enum(["active", "disabled", "locked"]).optional(),
});
