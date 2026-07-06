import { z } from "zod";

/**
 * Super Admin M — Background Jobs Console / Queue Governance request schemas.
 *
 * Enum sets mirror the CHECK constraints in migration 0101_jobs_ops. Every
 * list/query schema coerces + bounds pagination (pageSize ≤ 200); every mutation
 * validates its free-text and requires a ≥5-char reason for the high-risk /
 * export actions.
 */

const isoDate = z.string().date();

// The real, persisted job statuses (mirrors the widened jobs_status_check).
export const JOB_STATUSES = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
  "dead_letter",
] as const;

// List/report filter statuses: the persisted set plus the DERIVED `stuck`
// (status='running' AND locked_at older than the stuck threshold).
export const JOB_FILTER_STATUSES = [...JOB_STATUSES, "stuck"] as const;

// Attempt statuses (mirrors job_attempts.status CHECK).
export const ATTEMPT_STATUSES = [
  "running",
  "success",
  "failed",
  "retry",
  "cancelled",
  "dead_letter",
] as const;

// Derived source-module buckets (see SOURCE_MODULE in the service).
export const SOURCE_MODULES = [
  "Reports",
  "Communication",
  "Backup",
  "Export",
  "Integrations",
  "Observability",
  "System",
  "Other",
] as const;

export const JOB_SORTS = ["created_at", "started_at", "completed_at", "status", "attempts"] as const;

const reasonRequired = z
  .string()
  .trim()
  .min(5, "A reason of at least 5 characters is required")
  .max(500);
const reasonOptional = z.string().trim().max(500).optional();

// ---- Dashboard / window ----------------------------------------------------

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d", "custom"]).default("24h"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---- Job list --------------------------------------------------------------

export const listJobsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(JOB_FILTER_STATUSES).optional(),
  type: z.string().trim().max(120).optional(),
  queue: z.string().trim().max(120).optional(),
  institutionId: z.string().uuid().optional(),
  workerId: z.string().trim().max(200).optional(),
  module: z.enum(SOURCE_MODULES).optional(),
  attemptsMin: z.coerce.number().int().min(0).max(1000).optional(),
  createdFrom: isoDate.optional(),
  createdTo: isoDate.optional(),
  startedFrom: isoDate.optional(),
  startedTo: isoDate.optional(),
  completedFrom: isoDate.optional(),
  completedTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(JOB_SORTS).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const deadLetterQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.string().trim().max(120).optional(),
  institutionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ---- Single-job actions ----------------------------------------------------

// retry / cancel — reason is recommended but optional (they are reversible).
export const jobActionSchema = z.object({ reason: reasonOptional });
// dead-letter / requeue — high-risk, reason required.
export const highRiskActionSchema = z.object({ reason: reasonRequired });

export const bulkSchema = z.object({
  action: z.enum(["retry", "cancel", "dead_letter"]),
  ids: z.array(z.string().uuid()).min(1, "At least one job id is required").max(500),
  reason: reasonRequired,
});

// ---- Schedules -------------------------------------------------------------

export const SCHEDULE_SOURCES = ["reports", "backup", "export", "system"] as const;

export const scheduleActionSchema = z.object({
  action: z.enum(["pause", "resume", "run_now"]),
  reason: reasonOptional,
});

// ---- Alerts (reuse Observability L store) -----------------------------------

export const alertListQuerySchema = z.object({
  status: z.enum(["triggered", "acknowledged", "resolved", "suppressed"]).optional(),
  severity: z.enum(["info", "minor", "major", "critical"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const alertNoteSchema = z.object({ note: z.string().trim().max(1000).optional() });

// ---- Reports ---------------------------------------------------------------

export const reportsQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d", "custom"]).default("30d"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  type: z.string().trim().max(120).optional(),
  status: z.enum(JOB_FILTER_STATUSES).optional(),
  queue: z.string().trim().max(120).optional(),
  workerId: z.string().trim().max(200).optional(),
  institutionId: z.string().uuid().optional(),
  module: z.enum(SOURCE_MODULES).optional(),
});

// ---- Export (reason-gated) -------------------------------------------------

export const exportQuerySchema = listJobsQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    reason: reasonRequired,
    includeAttempts: z.coerce.boolean().default(false),
  });
