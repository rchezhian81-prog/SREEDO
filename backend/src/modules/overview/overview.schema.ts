import { z } from "zod";

/**
 * Super Admin E — Platform Overview Dashboard (read-only executive aggregator).
 *
 * The window is a coarse preset (today/7d/30d/this_month/last_month) or an
 * explicit custom range. It is mapped to whatever the reused module summaries
 * accept (today/7d/30d/custom + dateFrom/dateTo) and drives MY OWN group-by-day
 * trend queries. Dates are ISO yyyy-mm-dd; everything is bounded.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

export const overviewWindowEnum = z
  .enum(["today", "7d", "30d", "this_month", "last_month", "custom"])
  .default("30d");

export const overviewQuerySchema = z.object({
  window: overviewWindowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const overviewExportQuerySchema = z.object({
  window: overviewWindowEnum,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  format: z.enum(["csv", "json"]).default("csv"),
  // Optional operator note (masked before it is stored on the audit row).
  reason: z.string().trim().max(500).optional(),
});

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
export type OverviewExportQuery = z.infer<typeof overviewExportQuerySchema>;
