import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { activePlan, assertWithinPlanLimit } from "../../utils/plan-limits";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { invalidateDashboard } from "../dashboard/dashboard.routes";
import { dispatchEvent } from "../integrations/webhooks.delivery";
import type { z } from "zod";
import type {
  createStudentSchema,
  linkGuardianSchema,
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
  const student = await getStudent(rows[0].id, institutionId);
  // Fire-and-forget domain event for any registered webhooks. dispatchEvent
  // swallows its own errors, so this can never affect the create or its response.
  void dispatchEvent(institutionId, "student.created", {
    id: student.id,
    admissionNo,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  return student;
}

/**
 * Bulk-import students from validated rows (e.g. a parsed CSV). Atomic: every row
 * is inserted in one transaction, so a failure rolls the whole batch back. The
 * plan's student cap is enforced for the whole batch up front. Omitted admission
 * numbers are auto-generated from the same sequence as single creates.
 */
export async function importStudents(
  inputs: z.infer<typeof createStudentSchema>[],
  institutionId: string
): Promise<{ imported: number }> {
  if (inputs.length === 0) return { imported: 0 };
  const plan = await activePlan(institutionId);
  if (plan.maxStudents != null) {
    const { rows } = await query<{ c: number }>(
      "SELECT count(*)::int AS c FROM students WHERE institution_id = $1",
      [institutionId]
    );
    if (Number(rows[0].c) + inputs.length > plan.maxStudents) {
      throw ApiError.forbidden(
        `Plan limit: importing ${inputs.length} students would exceed the maximum (${plan.maxStudents}) for this plan`
      );
    }
  }
  try {
    const imported = await withTransaction(async (client) => {
      let count = 0;
      for (const input of inputs) {
        const admissionNo = input.admissionNo ?? (await nextAdmissionNo());
        await client.query(
          `INSERT INTO students (
             institution_id, admission_no, first_name, last_name, date_of_birth,
             gender, section_id, guardian_name, guardian_phone, guardian_email, address
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        count++;
      }
      return count;
    });
    invalidateDashboard(institutionId);
    return { imported };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.badRequest(
        "Duplicate admission number in the file or already on record"
      );
    }
    throw err;
  }
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

const GUARDIAN_SELECT = `
  g.id, g.user_id AS "userId", u.full_name AS "fullName", u.email,
  g.relationship, g.created_at AS "createdAt"
FROM guardians g JOIN users u ON u.id = g.user_id`;

/** Parent accounts linked to a student (admin view of who can see the child). */
export async function listGuardians(studentId: string, institutionId: string) {
  await getStudent(studentId, institutionId); // 404s if the student isn't in this tenant
  const { rows } = await query(
    `SELECT ${GUARDIAN_SELECT}
     WHERE g.student_id = $1 AND g.institution_id = $2
     ORDER BY u.full_name`,
    [studentId, institutionId]
  );
  return rows;
}

/** Link a parent account to a student so they can view it in the portal. */
export async function linkGuardian(
  studentId: string,
  input: z.infer<typeof linkGuardianSchema>,
  institutionId: string
) {
  await getStudent(studentId, institutionId); // 404s if the student isn't in this tenant
  // The linked account must be a parent in the same institution.
  const { rows: users } = await query<{ role: string }>(
    "SELECT role FROM users WHERE id = $1 AND institution_id = $2",
    [input.userId, institutionId]
  );
  if (!users[0]) throw ApiError.notFound("User not found");
  if (users[0].role !== "parent") {
    throw ApiError.badRequest("Only a parent account can be linked as a guardian");
  }
  const inserted = await query<{ id: string }>(
    `INSERT INTO guardians (institution_id, user_id, student_id, relationship)
     VALUES ($1, $2, $3, COALESCE($4, 'guardian'))
     ON CONFLICT (user_id, student_id) DO NOTHING
     RETURNING id`,
    [institutionId, input.userId, studentId, input.relationship ?? null]
  );
  if (!inserted.rows[0]) {
    throw ApiError.conflict("This parent is already linked to the student");
  }
  const { rows } = await query(
    `SELECT ${GUARDIAN_SELECT} WHERE g.id = $1`,
    [inserted.rows[0].id]
  );
  return rows[0];
}

/** Remove a guardian link (by its id) from a student. */
export async function unlinkGuardian(
  studentId: string,
  guardianId: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM guardians WHERE id = $1 AND student_id = $2 AND institution_id = $3",
    [guardianId, studentId, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Guardian link not found");
}
