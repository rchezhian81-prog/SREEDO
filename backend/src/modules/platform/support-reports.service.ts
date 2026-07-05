import type { z } from "zod";
import { query } from "../../db/postgres";
import type { reportsExportQuerySchema, reportsQuerySchema } from "./support.schema";
import {
  SESSION_COLS,
  SESSION_JOINS,
  SUPPORT_EXPORT_COLUMNS,
  buildSessionFilters,
  maskSessionRow,
  sweepExpired,
  toExportRow,
  type SessionFilters,
} from "./support.service";

/**
 * Super Admin G — Support Access reports (Phase 2, J).
 *
 * Ten read-only report datasets over the append-only session store, all sharing
 * ONE filter set (buildSessionFilters, the same the history list + exports use)
 * so a filter can never mean different things across the three surfaces. Row-based
 * reports return curated, masked session projections; the four *-wise reports
 * return aggregates. Every report also carries stable TOTALS over the filtered set.
 */

type ReportsQuery = z.infer<typeof reportsQuerySchema>;
type ReportsExportQuery = z.infer<typeof reportsExportQuerySchema>;

const GROUPED = new Set(["tenant-wise", "operator-wise", "reason-wise", "scope-wise"]);

/**
 * Extra SQL predicate for a ROW-based report type (null = no extra filter). Uses
 * COALESCE(ended_at, now()) so "long-running" catches both a still-live session
 * past 60m and a settled session that ran longer than 60m.
 */
function typePredicate(type: string): string | null {
  switch (type) {
    case "active":
      return "s.status = 'active' AND s.expires_at > now()";
    case "expired":
      return "s.status = 'expired'";
    case "revoked":
      return "s.status = 'revoked'";
    case "long-running":
      return "COALESCE(s.ended_at, now()) - s.created_at > interval '60 minutes'";
    case "high-risk":
      return "(s.scope IN ('write_enabled','module_limited') OR COALESCE(s.ended_at, now()) - s.created_at > interval '60 minutes')";
    default:
      // "all" and every grouped type add no extra row predicate.
      return null;
  }
}

/** Compose a base WHERE with an optional extra predicate. */
function withPredicate(whereSql: string, predicate: string | null): string {
  if (!predicate) return whereSql;
  return whereSql ? `${whereSql} AND ${predicate}` : `WHERE ${predicate}`;
}

/** Echo the filter subset that shaped the report (everything except `type`). */
function pickFilters(q: ReportsQuery | ReportsExportQuery): SessionFilters {
  return {
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    institutionId: q.institutionId,
    operatorId: q.operatorId,
    status: q.status,
    scope: q.scope,
    reasonTemplate: q.reasonTemplate,
  };
}

interface ReportTotals {
  sessionCount: number;
  avgDurationMinutes: number;
  activeCount: number;
  revokedCount: number;
  expiredCount: number;
  notificationSentCount: number;
  notificationFailedCount: number;
}

/** Totals over the base-filtered set (stable across report types for one filter). */
async function computeTotals(whereSql: string, params: unknown[]): Promise<ReportTotals> {
  const r = (
    await query<Record<string, string>>(
      `SELECT
         count(*)::int AS "sessionCount",
         COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (s.ended_at - s.created_at)) / 60.0)
                  FILTER (WHERE s.ended_at IS NOT NULL))::numeric, 0)::float AS "avgDurationMinutes",
         count(*) FILTER (WHERE s.status = 'active' AND s.expires_at > now())::int AS "activeCount",
         count(*) FILTER (WHERE s.status = 'revoked')::int AS "revokedCount",
         count(*) FILTER (WHERE s.status = 'expired')::int AS "expiredCount",
         count(*) FILTER (WHERE s.notify_status = 'sent')::int   AS "notificationSentCount",
         count(*) FILTER (WHERE s.notify_status = 'failed')::int AS "notificationFailedCount"
       FROM platform_impersonation_sessions s ${whereSql}`,
      params
    )
  ).rows[0];
  return {
    sessionCount: Number(r.sessionCount),
    avgDurationMinutes: Number(r.avgDurationMinutes),
    activeCount: Number(r.activeCount),
    revokedCount: Number(r.revokedCount),
    expiredCount: Number(r.expiredCount),
    notificationSentCount: Number(r.notificationSentCount),
    notificationFailedCount: Number(r.notificationFailedCount),
  };
}

/** Curated, masked session rows for a row-based report type (cap 1000). */
async function computeRows(type: string, whereSql: string, params: unknown[]) {
  const where = withPredicate(whereSql, typePredicate(type));
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${SESSION_COLS} ${SESSION_JOINS} ${where}
     ORDER BY s.created_at DESC LIMIT 1000`,
    params
  );
  return rows.map(maskSessionRow);
}

// Shared per-group aggregate columns.
const GROUP_AGG = `
  count(*)::int AS "sessions",
  COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, now()) - s.created_at)) / 60.0)
           FILTER (WHERE s.ended_at IS NOT NULL))::numeric, 0)::float AS "avgDurationMinutes",
  count(*) FILTER (WHERE s.status = 'active' AND s.expires_at > now())::int AS "activeCount",
  count(*) FILTER (WHERE s.status = 'revoked')::int AS "revokedCount",
  count(*) FILTER (WHERE s.status = 'expired')::int AS "expiredCount"`;

/** Aggregate rows for a grouped report type. */
async function computeGroups(type: string, whereSql: string, params: unknown[]) {
  let dims: string;
  let joins = "";
  let groupBy: string;
  switch (type) {
    case "tenant-wise":
      dims = `s.institution_id AS "institutionId", inst.name AS "institutionName", inst.code AS "institutionCode"`;
      joins = `LEFT JOIN institutions inst ON inst.id = s.institution_id`;
      groupBy = `s.institution_id, inst.name, inst.code`;
      break;
    case "operator-wise":
      dims = `s.actor_id AS "operatorId", op.email AS "operatorEmail", op.full_name AS "operatorName"`;
      joins = `LEFT JOIN users op ON op.id = s.actor_id`;
      groupBy = `s.actor_id, op.email, op.full_name`;
      break;
    case "reason-wise":
      dims = `s.reason_template AS "reasonTemplate"`;
      groupBy = `s.reason_template`;
      break;
    default: // scope-wise
      dims = `s.scope AS "scope"`;
      groupBy = `s.scope`;
      break;
  }
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${dims}, ${GROUP_AGG}
     FROM platform_impersonation_sessions s ${joins} ${whereSql}
     GROUP BY ${groupBy}
     ORDER BY count(*) DESC LIMIT 100`,
    params
  );
  return rows;
}

/** Produce one of the ten report datasets (rows OR groups) plus filtered totals. */
export async function reports(q: ReportsQuery) {
  await sweepExpired();
  const { whereSql, params } = buildSessionFilters(pickFilters(q));
  const totals = await computeTotals(whereSql, params);
  const filters = pickFilters(q);
  if (GROUPED.has(q.type)) {
    return { type: q.type, filters, totals, groups: await computeGroups(q.type, whereSql, params) };
  }
  return { type: q.type, filters, totals, rows: await computeRows(q.type, whereSql, params) };
}

/**
 * Flatten a report to curated, masked export rows: the session rows that make up
 * the report (base filters + the row-type predicate; grouped types export the
 * whole filtered set they aggregate). Reuses the history export columns. Cap 50000.
 */
export async function exportReport(q: ReportsExportQuery) {
  await sweepExpired();
  const { whereSql, params } = buildSessionFilters(pickFilters(q));
  const where = withPredicate(whereSql, typePredicate(q.type));
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${SESSION_COLS}, rb.email AS "revokedByEmail"
     ${SESSION_JOINS}
     LEFT JOIN users rb ON rb.id = s.revoked_by
     ${where}
     ORDER BY s.created_at DESC LIMIT 50000`,
    params
  );
  return { columns: SUPPORT_EXPORT_COLUMNS, rows: rows.map(toExportRow) };
}
