import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { assertWithinPlanLimit } from "../../utils/plan-limits";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { invalidateDashboard } from "../dashboard/dashboard.routes";
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
  // Atomic sequence (migration 0009) — race-free unlike the old count(*)+1.
  const { rows } = await query<{ nextval: string }>(
    "SELECT nextval('student_admission_seq') AS nextval"
  );
  return `ADM-${year}-${String(Number(rows[0].nextval)).padStart(4, "0")}`;
}

export async function listStudents(
  pagination: Pagination,
  filters: z.infer<typeof listStudentsQuerySchema>,
  institutionId: string,
  restrictIds?: string[] | null
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["s.institution_id = $1"];
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`s.section_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`s.status = $${params.length}`);
  } else {
    // Archived (soft-deleted) students are hidden unless explicitly requested.
    conditions.push(`s.status <> 'archived'`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`
    );
  }
  // Owner-scoping: restrict to a set of ids (student/parent), null = unrestricted.
  if (restrictIds != null) {
    params.push(restrictIds);
    conditions.push(`s.id = ANY($${params.length}::uuid[])`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

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

export async function getStudent(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${STUDENT_SELECT} WHERE s.id = $1 AND s.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Student not found");
  return rows[0];
}

export async function createStudent(
  input: z.infer<typeof createStudentSchema>,
  institutionId: string
) {
  await assertWithinPlanLimit(institutionId, "students");
  const admissionNo = input.admissionNo ?? (await nextAdmissionNo());
  const { rows } = await query<{ id: string }>(
    `INSERT INTO students (
       institution_id, admission_no, first_name, last_name, date_of_birth,
       gender, section_id, guardian_name, guardian_phone, guardian_email, address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      institutionId,
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
  invalidateDashboard(institutionId); // student count changed
  return getStudent(rows[0].id, institutionId);
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
  input: z.infer<typeof updateStudentSchema>,
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
    `UPDATE students SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Student not found");
  // A status change (e.g. active ↔ archived) shifts the active-student count.
  if (input.status !== undefined) invalidateDashboard(institutionId);
  return getStudent(id, institutionId);
}

/** Soft delete: mark the student archived, preserving their history. */
export async function archiveStudent(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "UPDATE students SET status = 'archived' WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Student not found");
  invalidateDashboard(institutionId); // active-student count changed
}

/** Hard delete: removes the row and cascades to attendance/invoices/payments. */
export async function hardDeleteStudent(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM students WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Student not found");
  invalidateDashboard(institutionId); // student + cascaded attendance/fees removed
}

/** Resolves the student record linked to a user account, if any. */
export async function studentIdForUser(userId: string): Promise<string | null> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM students WHERE user_id = $1",
    [userId]
  );
  return rows[0]?.id ?? null;
}

/** Student ids a guardian (parent) account is linked to, within their tenant. */
export async function childStudentIdsForUser(
  userId: string,
  institutionId: string
): Promise<string[]> {
  const { rows } = await query<{ student_id: string }>(
    "SELECT student_id FROM guardians WHERE user_id = $1 AND institution_id = $2",
    [userId, institutionId]
  );
  return rows.map((r) => r.student_id);
}
