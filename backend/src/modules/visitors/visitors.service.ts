import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createVisitorSchema,
  updateVisitorSchema,
  listVisitorsQuerySchema,
} from "./visitors.schema";

const SELECT = `
  v.id,
  v.visitor_name AS "visitorName",
  v.phone,
  v.purpose,
  v.whom_to_meet AS "whomToMeet",
  v.badge_no AS "badgeNo",
  v.in_time AS "inTime",
  v.out_time AS "outTime",
  v.created_at AS "createdAt"
FROM visitor_logs v`;

export async function listVisitors(
  pagination: Pagination,
  filters: z.infer<typeof listVisitorsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["v.institution_id = $1"];
  if (filters.active === "true") {
    conditions.push("v.out_time IS NULL");
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(v.visitor_name ILIKE $${params.length} OR v.phone ILIKE $${params.length} OR v.whom_to_meet ILIKE $${params.length})`
    );
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`v.in_time::date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`v.in_time::date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM visitor_logs v ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY v.in_time DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getVisitor(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE v.id = $1 AND v.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Visitor entry not found");
  return rows[0];
}

export async function createVisitor(
  input: z.infer<typeof createVisitorSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO visitor_logs (
       institution_id, visitor_name, phone, purpose, whom_to_meet, badge_no, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      institutionId,
      input.visitorName,
      input.phone ?? null,
      input.purpose ?? null,
      input.whomToMeet ?? null,
      input.badgeNo ?? null,
      userId,
    ]
  );
  return getVisitor(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  visitorName: "visitor_name",
  phone: "phone",
  purpose: "purpose",
  whomToMeet: "whom_to_meet",
  badgeNo: "badge_no",
};

export async function updateVisitor(
  id: string,
  input: z.infer<typeof updateVisitorSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(UPDATE_COLUMN_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE visitor_logs SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Visitor entry not found");
  return getVisitor(id, institutionId);
}

/** Record the visitor leaving (sets out_time once). */
export async function checkoutVisitor(id: string, institutionId: string) {
  const visitor = await getVisitor(id, institutionId);
  if (visitor.outTime) {
    throw ApiError.badRequest("Visitor is already checked out");
  }
  await query(
    "UPDATE visitor_logs SET out_time = now() WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  return getVisitor(id, institutionId);
}

export async function deleteVisitor(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM visitor_logs WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Visitor entry not found");
}
