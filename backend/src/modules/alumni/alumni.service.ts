import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createAlumniSchema,
  updateAlumniSchema,
  listAlumniQuerySchema,
} from "./alumni.schema";

const SELECT = `
  a.id,
  a.student_id AS "studentId",
  a.full_name AS "fullName",
  a.batch_year AS "batchYear",
  a.email,
  a.phone,
  a.current_company AS "currentCompany",
  a.current_role AS "currentRole",
  a.location,
  a.higher_education AS "higherEducation",
  a.notes,
  a.created_at AS "createdAt",
  a.updated_at AS "updatedAt"
FROM alumni a`;

export async function listAlumni(
  pagination: Pagination,
  filters: z.infer<typeof listAlumniQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["a.institution_id = $1"];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(a.full_name ILIKE $${params.length} OR a.current_company ILIKE $${params.length} OR a.email ILIKE $${params.length})`
    );
  }
  if (filters.batchYear !== undefined) {
    params.push(filters.batchYear);
    conditions.push(`a.batch_year = $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM alumni a ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY a.batch_year DESC, a.full_name ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getAlumnus(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE a.id = $1 AND a.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Alumnus not found");
  return rows[0];
}

export async function createAlumnus(
  input: z.infer<typeof createAlumniSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO alumni (
       institution_id, student_id, full_name, batch_year, email, phone,
       current_company, current_role, location, higher_education, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      institutionId,
      input.studentId ?? null,
      input.fullName,
      input.batchYear,
      input.email || null,
      input.phone ?? null,
      input.currentCompany ?? null,
      input.currentRole ?? null,
      input.location ?? null,
      input.higherEducation ?? null,
      input.notes ?? null,
      userId,
    ]
  );
  return getAlumnus(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  studentId: "student_id",
  fullName: "full_name",
  batchYear: "batch_year",
  email: "email",
  phone: "phone",
  currentCompany: "current_company",
  currentRole: "current_role",
  location: "location",
  higherEducation: "higher_education",
  notes: "notes",
};

export async function updateAlumnus(
  id: string,
  input: z.infer<typeof updateAlumniSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(UPDATE_COLUMN_MAP)) {
    let value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      // Normalise a cleared email ("") to NULL.
      if (field === "email" && value === "") value = null;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE alumni SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Alumnus not found");
  return getAlumnus(id, institutionId);
}

export async function deleteAlumnus(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM alumni WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Alumnus not found");
}
