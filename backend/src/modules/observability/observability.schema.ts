import { z } from "zod";

/**
 * Super Admin L — Health / Observability request schemas.
 *
 * Enum sets mirror the CHECK constraints in migration 0100. Every list/query
 * schema coerces + bounds pagination; every mutation validates its free-text.
 */

const isoDate = z.string().date();

export const SEVERITIES = ["info", "minor", "major", "critical"] as const;
export const INCIDENT_STATUSES = [
  "open",
  "investigating",
  "monitoring",
  "resolved",
  "closed",
] as const;
export const INCIDENT_TYPES = [
  "api",
  "database",
  "frontend",
  "worker",
  "email",
  "storage",
  "backup",
  "payment",
  "security",
  "other",
] as const;
export const ALERT_RULE_TYPES = [
  "api_down",
  "db_down",
  "mongo_down",
  "worker_down",
  "scheduler_stalled",
  "queue_depth_high",
  "job_failure_spike",
  "error_rate_high",
  "latency_high",
  "smtp_failures",
  "storage_high",
  "backup_failed",
  "gateway_degraded",
  "disk_low",
  "memory_high",
  "security_event",
] as const;
export const ALERT_STATUSES = ["triggered", "acknowledged", "resolved", "suppressed"] as const;
export const ERROR_TRIAGE_STATUSES = ["new", "investigating", "resolved", "ignored"] as const;

// ---- Dashboard / windows ---------------------------------------------------

export const summaryQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d", "custom"]).default("24h"),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const uptimeQuerySchema = z.object({
  service: z.string().trim().max(50).optional(),
  window: z.enum(["24h", "7d", "30d"]).default("7d"),
});

// ---- Incidents -------------------------------------------------------------

export const incidentListQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  type: z.enum(INCIDENT_TYPES).optional(),
  active: z.coerce.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const incidentCreateSchema = z.object({
  title: z.string().trim().min(3).max(300),
  severity: z.enum(SEVERITIES).default("minor"),
  type: z.enum(INCIDENT_TYPES).default("other"),
  impact: z.string().trim().max(2000).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});

export const incidentUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(300).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    type: z.enum(INCIDENT_TYPES).optional(),
    impact: z.string().trim().max(2000).nullable().optional(),
    rootCause: z.string().trim().max(2000).nullable().optional(),
    resolution: z.string().trim().max(2000).nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const incidentResolveSchema = z.object({
  resolution: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const incidentReopenSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export const incidentEventSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

// ---- Alert rules -----------------------------------------------------------

export const alertRuleCreateSchema = z.object({
  name: z.string().trim().min(3).max(200),
  type: z.enum(ALERT_RULE_TYPES),
  threshold: z.number().finite().nullable().optional(),
  windowMinutes: z.number().int().min(1).max(1440).default(5),
  severity: z.enum(SEVERITIES).default("major"),
  enabled: z.boolean().default(true),
  notifyTarget: z.string().trim().max(500).nullable().optional(),
  cooldownMinutes: z.number().int().min(0).max(10080).default(30),
});

export const alertRuleUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(200).optional(),
    type: z.enum(ALERT_RULE_TYPES).optional(),
    threshold: z.number().finite().nullable().optional(),
    windowMinutes: z.number().int().min(1).max(1440).optional(),
    severity: z.enum(SEVERITIES).optional(),
    enabled: z.boolean().optional(),
    notifyTarget: z.string().trim().max(500).nullable().optional(),
    cooldownMinutes: z.number().int().min(0).max(10080).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// ---- Alert feed ------------------------------------------------------------

export const alertListQuerySchema = z.object({
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ruleId: z.string().uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const alertAckSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const alertResolveSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const alertNoteSchema = z.object({ note: z.string().trim().min(1).max(1000) });
export const alertLinkIncidentSchema = z.object({ incidentId: z.string().uuid() });

export const alertExportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// ---- Error explorer --------------------------------------------------------

export const errorListQuerySchema = z.object({
  route: z.string().trim().max(300).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  errorType: z.string().trim().max(50).optional(),
  status: z.enum(ERROR_TRIAGE_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const errorTriageSchema = z.object({
  status: z.enum(ERROR_TRIAGE_STATUSES),
  note: z.string().trim().max(1000).optional(),
});

export const errorSummaryQuerySchema = z.object({
  window: z.enum(["today", "24h", "7d", "30d"]).default("24h"),
});

// ---- Logs ------------------------------------------------------------------

export const logsQuerySchema = z.object({
  source: z.enum(["errors", "audit", "all"]).default("all"),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const logExportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(500),
  source: z.enum(["errors", "audit", "all"]).default("all"),
});

// ---- SMTP test -------------------------------------------------------------

export const smtpTestSchema = z.object({
  to: z.string().trim().email(),
});
