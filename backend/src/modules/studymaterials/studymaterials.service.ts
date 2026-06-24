import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createMaterialSchema,
  updateMaterialSchema,
  listMaterialsQuerySchema,
} from "./studymaterials.schema";

const SELECT = `
  sm.id,
  sm.class_id AS "classId",
  c.name AS "className",
  sm.subject_id AS "subjectId",
  sub.name AS "subjectName",
  sm.title,
  sm.description,
  sm.file_url AS "fileUrl",
  sm.created_at AS "createdAt",
  sm.updated_at AS "updatedAt"
FROM study_materials sm
LEFT JOIN classes c ON c.id = sm.class_id
LEFT JOIN subjects sub ON sub.id = sm.subject_id`;

export async function listMaterials(
  pagination: Pagination,
  filters: z.infer<typeof listMaterialsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["sm.institution_id = $1"];
  if (filters.classId) {
    params.push(filters.classId);
    conditions.push(`sm.class_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    conditions.push(`sm.subject_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(sm.title ILIKE $${params.length} OR sm.description ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM study_materials sm ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY sm.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

/** Materials visible to a student: their class's + school-wide (NULL class). */
export async function listMaterialsForStudent(
  studentId: string,
  institutionId: string
) {
  const { rows } = await query(
    `SELECT ${SELECT}
     WHERE sm.institution_id = $1
       AND (
         sm.class_id IS NULL
         OR sm.class_id = (
           SELECT sec.class_id FROM students st
           JOIN sections sec ON sec.id = st.section_id
           WHERE st.id = $2 AND st.institution_id = $1
         )
       )
     ORDER BY sm.created_at DESC`,
    [institutionId, studentId]
  );
  return rows;
}

export async function getMaterial(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE sm.id = $1 AND sm.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Study material not found");
  return rows[0];
}

export async function createMaterial(
  input: z.infer<typeof createMaterialSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO study_materials (
       institution_id, class_id, subject_id, title, description, file_url, uploaded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      institutionId,
      input.classId ?? null,
      input.subjectId ?? null,
      input.title,
      input.description ?? null,
      input.fileUrl,
      userId,
    ]
  );
  return getMaterial(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  classId: "class_id",
  subjectId: "subject_id",
  title: "title",
  description: "description",
  fileUrl: "file_url",
};

export async function updateMaterial(
  id: string,
  input: z.infer<typeof updateMaterialSchema>,
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
    `UPDATE study_materials SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Study material not found");
  return getMaterial(id, institutionId);
}

export async function deleteMaterial(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM study_materials WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Study material not found");
}
