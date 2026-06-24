import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createVisitSchema,
  updateVisitSchema,
  listVisitsQuerySchema,
} from "./infirmary.schema";

const SELECT = `
  v.id,
  v.student_id AS "studentId",
  v.patient_name AS "patientName",
  to_char(v.visit_date, 'YYYY-MM-DD') AS "visitDate",
  v.complaint,
  v.treatment,
  v.temperature,
  v.remarks,
  v.created_at AS "createdAt"
FROM infirmary_visits v`;

export async function listVisits(
  pagination: Pagination,
  filters: z.infer<typeof listVisitsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["v.institution_id = $1"];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(v.patient_name ILIKE $${params.length} OR v.complaint ILIKE $${params.length})`
    );
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`v.visit_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`v.visit_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM infirmary_visits v ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY v.visit_date DESC, v.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getVisit(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE v.id = $1 AND v.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Visit not found");
  return rows[0];
}

export async function createVisit(
  input: z.infer<typeof createVisitSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO infirmary_visits (
       institution_id, student_id, patient_name, visit_date, complaint, treatment,
       temperature, remarks, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      institutionId,
      input.studentId ?? null,
      input.patientName,
      input.visitDate,
      input.complaint ?? null,
      input.treatment ?? null,
      input.temperature ?? null,
      input.remarks ?? null,
      userId,
    ]
  );
  return getVisit(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  studentId: "student_id",
  patientName: "patient_name",
  visitDate: "visit_date",
  complaint: "complaint",
  treatment: "treatment",
  temperature: "temperature",
  remarks: "remarks",
};

export async function updateVisit(
  id: string,
  input: z.infer<typeof updateVisitSchema>,
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
  sets.push("updated_at = now()");
  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE infirmary_visits SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Visit not found");
  return getVisit(id, institutionId);
}

export async function deleteVisit(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM infirmary_visits WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Visit not found");
}
