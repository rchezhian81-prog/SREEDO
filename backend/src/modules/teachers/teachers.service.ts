import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createTeacherSchema,
  updateTeacherSchema,
} from "./teachers.schema";

const TEACHER_COLUMNS = `
  id,
  employee_no AS "employeeNo",
  first_name AS "firstName",
  last_name AS "lastName",
  email,
  phone,
  qualification,
  specialization,
  joining_date AS "joiningDate",
  is_active AS "isActive",
  created_at AS "createdAt"`;

async function nextEmployeeNo(): Promise<string> {
  // Atomic sequence (migration 0009) — race-free unlike the old count(*)+1.
  const { rows } = await query<{ nextval: string }>(
    "SELECT nextval('teacher_employee_seq') AS nextval"
  );
  return `EMP-${String(Number(rows[0].nextval)).padStart(4, "0")}`;
}

export async function listTeachers(
  pagination: Pagination,
  filters: { search?: string }
) {
  const params: unknown[] = [];
  let where = "";
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where = `WHERE (first_name ILIKE $1 OR last_name ILIKE $1 OR employee_no ILIKE $1)`;
  }
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM teachers ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${TEACHER_COLUMNS} FROM teachers ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getTeacher(id: string) {
  const { rows } = await query(
    `SELECT ${TEACHER_COLUMNS} FROM teachers WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Teacher not found");
  return rows[0];
}

export async function createTeacher(
  input: z.infer<typeof createTeacherSchema>
) {
  const employeeNo = input.employeeNo ?? (await nextEmployeeNo());
  const { rows } = await query(
    `INSERT INTO teachers (
       employee_no, first_name, last_name, email, phone,
       qualification, specialization, joining_date
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${TEACHER_COLUMNS}`,
    [
      employeeNo,
      input.firstName,
      input.lastName,
      input.email ?? null,
      input.phone ?? null,
      input.qualification ?? null,
      input.specialization ?? null,
      input.joiningDate ?? null,
    ]
  );
  return rows[0];
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  employeeNo: "employee_no",
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  phone: "phone",
  qualification: "qualification",
  specialization: "specialization",
  joiningDate: "joining_date",
  isActive: "is_active",
};

export async function updateTeacher(
  id: string,
  input: z.infer<typeof updateTeacherSchema>
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
  const { rows } = await query(
    `UPDATE teachers SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING ${TEACHER_COLUMNS}`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Teacher not found");
  return rows[0];
}

export async function removeTeacher(id: string): Promise<void> {
  const { rowCount } = await query("DELETE FROM teachers WHERE id = $1", [id]);
  if (!rowCount) throw ApiError.notFound("Teacher not found");
}
