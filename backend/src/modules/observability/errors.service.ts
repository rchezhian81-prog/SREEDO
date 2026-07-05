import type { z } from "zod";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { maskFreeText } from "../platform/audit.service";
import { recordAudit, type Actor } from "./audit";
import type {
  errorListQuerySchema,
  errorSummaryQuerySchema,
  errorTriageSchema,
} from "./observability.schema";

/**
 * Error Explorer (Super Admin L). Reads the `error_events` store the capture
 * middleware populates. Messages are already masked at capture; they are re-masked
 * defensively before return (invariant #2). Triage is a status/annotation
 * transition (audited); rows are never surfaced with a stack, header or body.
 */

const SELECT = `
  id, fingerprint, route, method, status_code AS "statusCode", error_type AS "errorType",
  message, last_request_id AS "lastRequestId", last_actor_id AS "lastActorId",
  last_institution_id AS "lastInstitutionId", status, count,
  first_seen AS "firstSeen", last_seen AS "lastSeen"`;

type ListQuery = z.infer<typeof errorListQuerySchema>;
type TriageInput = z.infer<typeof errorTriageSchema>;
type SummaryQuery = z.infer<typeof errorSummaryQuerySchema>;

/** Re-mask the free-text message before it leaves the service. */
function maskRow(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, message: r.message ? maskFreeText(r.message) : r.message };
}

export async function listErrors(q: ListQuery) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.route) add((n) => `route ILIKE $${n}`, `%${q.route}%`);
  if (q.statusCode) add((n) => `status_code = $${n}`, q.statusCode);
  if (q.errorType) add((n) => `error_type = $${n}`, q.errorType);
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.q) add((n) => `(message ILIKE $${n} OR route ILIKE $${n})`, `%${q.q}%`);
  if (q.dateFrom) add((n) => `last_seen >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `last_seen <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM error_events ${whereSql}`, params)).rows[0].n
  );
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query<Record<string, unknown>>(
    `SELECT ${SELECT} FROM error_events ${whereSql}
     ORDER BY last_seen DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows: rows.map(maskRow), total, page: q.page, pageSize: q.pageSize };
}

export async function getError(id: string) {
  const { rows } = await query<Record<string, unknown>>(`SELECT ${SELECT} FROM error_events WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Error event not found");
  return maskRow(rows[0]);
}

export async function triageError(id: string, input: TriageInput, actor: Actor) {
  const { rows } = await query<{ id: string; status: string }>(
    "UPDATE error_events SET status = $2 WHERE id = $1 RETURNING id, status",
    [id, input.status]
  );
  if (!rows[0]) throw ApiError.notFound("Error event not found");
  await recordAudit(actor, {
    action: "error.triage",
    targetType: "error_event",
    targetId: id,
    detail: { status: input.status, note: input.note ? maskFreeText(input.note) : null },
  });
  return getError(id);
}

function windowSql(window: SummaryQuery["window"]): string {
  if (window === "today") return "last_seen >= date_trunc('day', now())";
  if (window === "24h") return "last_seen >= now() - interval '24 hours'";
  if (window === "7d") return "last_seen >= now() - interval '7 days'";
  return "last_seen >= now() - interval '30 days'";
}

/** Aggregates for the explorer dashboard: totals + top routes + status classes. */
export async function errorSummary(q: SummaryQuery) {
  const w = windowSql(q.window);
  const totals = (
    await query<Record<string, number>>(
      `SELECT
         count(*)::int AS "distinctErrors",
         COALESCE(sum(count),0)::int AS "totalOccurrences",
         count(*) FILTER (WHERE status='new')::int AS "new",
         count(*) FILTER (WHERE status='investigating')::int AS "investigating",
         count(*) FILTER (WHERE status_code >= 500)::int AS "serverErrors",
         count(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS "clientErrors"
       FROM error_events WHERE ${w}`
    )
  ).rows[0];

  const byRoute = (
    await query(
      `SELECT route, count(*)::int AS "distinct", COALESCE(sum(count),0)::int AS occurrences
       FROM error_events WHERE ${w}
       GROUP BY route ORDER BY occurrences DESC LIMIT 20`
    )
  ).rows;

  const byStatusClass = (
    await query(
      `SELECT (status_code / 100)::text || 'xx' AS "statusClass",
              COALESCE(sum(count),0)::int AS occurrences
       FROM error_events WHERE ${w}
       GROUP BY 1 ORDER BY 1`
    )
  ).rows;

  return {
    window: q.window,
    totals: {
      distinctErrors: Number(totals.distinctErrors),
      totalOccurrences: Number(totals.totalOccurrences),
      new: Number(totals.new),
      investigating: Number(totals.investigating),
      serverErrors: Number(totals.serverErrors),
      clientErrors: Number(totals.clientErrors),
    },
    byRoute,
    byStatusClass,
  };
}
