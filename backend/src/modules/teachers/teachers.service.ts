import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { nextTenantNumber } from "../../utils/tenant-sequence";
import { activePlan, assertWithinPlanLimit } from "../../utils/plan-limits";
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
  staff_type AS "staffType",
  designation,
  department,
  created_at AS "createdAt"`;

async function nextEmployeeNo(
  institutionId: string,
  client?: PoolClient
): Promise<string> {
  // Per-tenant, race-free counter (migration 0105) — replaces the old GLOBAL
  // teacher_employee_seq so two institutions can number independently.
  const n = await nextTenantNumber(institutionId, "teacher_employee", client);
  return `EMP-${String(n).padStart(4, "0")}`;
}

export async function listTeachers(
  pagination: Pagination,
  filters: { search?: string; staffType?: "teaching" | "non_teaching" | "all" },
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  let where = "WHERE institution_id = $1";
  // Default (no staffType) → teaching-only, so the Teachers list and every
  // teacher-assignment picker keep showing teaching staff and never surface
  // non-teaching staff. "all" opts into the full staff set; "non_teaching"
  // drives the Staff Directory.
  const staffType = filters.staffType ?? "teaching";
  if (staffType !== "all") {
    params.push(staffType);
    where += ` AND staff_type = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR employee_no ILIKE $${params.length})`;
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

export async function getTeacher(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${TEACHER_COLUMNS} FROM teachers WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Teacher not found");
  return rows[0];
}

export async function createTeacher(
  input: z.infer<typeof createTeacherSchema>,
  institutionId: string
) {
  await assertWithinPlanLimit(institutionId, "staff");
  const employeeNo = input.employeeNo ?? (await nextEmployeeNo(institutionId));
  const { rows } = await query(
    `INSERT INTO teachers (
       institution_id, employee_no, first_name, last_name, email, phone,
       qualification, specialization, joining_date, staff_type, designation, department
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10,'teaching'), $11, $12)
     RETURNING ${TEACHER_COLUMNS}`,
    [
      institutionId,
      employeeNo,
      input.firstName,
      input.lastName,
      input.email ?? null,
      input.phone ?? null,
      input.qualification ?? null,
      input.specialization ?? null,
      input.joiningDate ?? null,
      input.staffType ?? null,
      input.designation ?? null,
      input.department ?? null,
    ]
  );
  return rows[0];
}

/**
 * Bulk-import teachers from validated rows (e.g. a parsed CSV). Atomic: the whole
 * batch is inserted in one transaction. The plan's staff cap is enforced for the
 * batch up front. Omitted employee numbers are auto-generated.
 */
export async function importTeachers(
  inputs: z.infer<typeof createTeacherSchema>[],
  institutionId: string
): Promise<{ imported: number }> {
  if (inputs.length === 0) return { imported: 0 };
  const plan = await activePlan(institutionId);
  if (plan.maxStaff != null) {
    const { rows } = await query<{ c: number }>(
      "SELECT count(*)::int AS c FROM teachers WHERE institution_id = $1",
      [institutionId]
    );
    if (Number(rows[0].c) + inputs.length > plan.maxStaff) {
      throw ApiError.forbidden(
        `Plan limit: importing ${inputs.length} staff would exceed the maximum (${plan.maxStaff}) for this plan`
      );
    }
  }
  try {
    const imported = await withTransaction(async (client) => {
      let count = 0;
      for (const input of inputs) {
        const employeeNo =
          input.employeeNo ?? (await nextEmployeeNo(institutionId, client));
        await client.query(
          `INSERT INTO teachers (
             institution_id, employee_no, first_name, last_name, email, phone,
             qualification, specialization, joining_date, staff_type, designation, department
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10,'teaching'), $11, $12)`,
          [
            institutionId,
            employeeNo,
            input.firstName,
            input.lastName,
            input.email ?? null,
            input.phone ?? null,
            input.qualification ?? null,
            input.specialization ?? null,
            input.joiningDate ?? null,
            input.staffType ?? null,
            input.designation ?? null,
            input.department ?? null,
          ]
        );
        count++;
      }
      return count;
    });
    return { imported };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.badRequest(
        "Duplicate employee number in the file or already on record"
      );
    }
    throw err;
  }
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
  staffType: "staff_type",
  designation: "designation",
  department: "department",
};

export async function updateTeacher(
  id: string,
  input: z.infer<typeof updateTeacherSchema>,
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
  const { rows } = await query(
    `UPDATE teachers SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING ${TEACHER_COLUMNS}`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Teacher not found");
  return rows[0];
}

export async function removeTeacher(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM teachers WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Teacher not found");
}
