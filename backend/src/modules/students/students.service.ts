import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createStudentSchema,
  listStudentsQuerySchema,
  updateStudentSchema,
} from "./students.schema";

const STUDENT_SELECT = `
  s.id,
  s.admission_no AS "admissionNo",
  s.first_name AS "firstName",
  s.last_name AS "lastName",
  s.date_of_birth AS "dateOfBirth",
  s.gender,
  s.section_id AS "sectionId",
  sec.name AS "sectionName",
  c.name AS "className",
  s.guardian_name AS "guardianName",
  s.guardian_phone AS "guardianPhone",
  s.guardian_email AS "guardianEmail",
  s.address,
  s.status,
  s.enrolled_at AS "enrolledAt",
  s.created_at AS "createdAt"
FROM students s
LEFT JOIN sections sec ON sec.id = s.section_id
LEFT JOIN classes c ON c.id = sec.class_id`;

async function nextAdmissionNo(): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await query<{ count: string }>(
    "SELECT count(*) FROM students"
  );
  const sequence = Number(rows[0].count) + 1;
  return `ADM-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function listStudents(
  pagination: Pagination,
  filters: z.infer<typeof listStudentsQuerySchema>
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`s.section_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM students s ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${STUDENT_SELECT} ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getStudent(id: string) {
  const { rows } = await query(
    `SELECT ${STUDENT_SELECT} WHERE s.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Student not found");
  return rows[0];
}

export async function createStudent(
  input: z.infer<typeof createStudentSchema>
) {
  const admissionNo = input.admissionNo ?? (await nextAdmissionNo());
  const { rows } = await query<{ id: string }>(
    `INSERT INTO students (
       admission_no, first_name, last_name, date_of_birth, gender, section_id,
       guardian_name, guardian_phone, guardian_email, address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      admissionNo,
      input.firstName,
      input.lastName,
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.sectionId ?? null,
      input.guardianName ?? null,
      input.guardianPhone ?? null,
      input.guardianEmail ?? null,
      input.address ?? null,
    ]
  );
  return getStudent(rows[0].id);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  admissionNo: "admission_no",
  firstName: "first_name",
  lastName: "last_name",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  sectionId: "section_id",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  guardianEmail: "guardian_email",
  address: "address",
  status: "status",
};

export async function updateStudent(
  id: string,
  input: z.infer<typeof updateStudentSchema>
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
  const { rowCount } = await query(
    `UPDATE students SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Student not found");
  return getStudent(id);
}

export async function removeStudent(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM students WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Student not found");
}
