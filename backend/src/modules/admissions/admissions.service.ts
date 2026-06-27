import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { createStudent } from "../students/students.service";
import type { z } from "zod";
import type {
  createAdmissionSchema,
  updateAdmissionSchema,
  listAdmissionsQuerySchema,
  convertAdmissionSchema,
  publicEnquirySchema,
} from "./admissions.schema";

const SELECT = `
  a.id,
  a.first_name AS "firstName",
  a.last_name AS "lastName",
  to_char(a.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth",
  a.gender,
  a.grade_applying AS "gradeApplying",
  a.guardian_name AS "guardianName",
  a.guardian_phone AS "guardianPhone",
  a.guardian_email AS "guardianEmail",
  a.address,
  a.source,
  a.status,
  a.notes,
  a.section_id AS "sectionId",
  a.student_id AS "studentId",
  a.created_at AS "createdAt",
  a.updated_at AS "updatedAt"
FROM admission_applications a`;

export async function listAdmissions(
  pagination: Pagination,
  filters: z.infer<typeof listAdmissionsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["a.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(a.first_name ILIKE $${params.length} OR a.last_name ILIKE $${params.length} OR a.guardian_phone ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM admission_applications a ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getAdmission(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE a.id = $1 AND a.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Application not found");
  return rows[0];
}

export async function createAdmission(
  input: z.infer<typeof createAdmissionSchema>,
  institutionId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO admission_applications (
       institution_id, first_name, last_name, date_of_birth, gender, grade_applying,
       guardian_name, guardian_phone, guardian_email, address, source, status, notes, section_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      institutionId,
      input.firstName,
      input.lastName,
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.gradeApplying ?? null,
      input.guardianName ?? null,
      input.guardianPhone ?? null,
      input.guardianEmail ?? null,
      input.address ?? null,
      input.source ?? null,
      input.status ?? "enquiry",
      input.notes ?? null,
      input.sectionId ?? null,
    ]
  );
  return getAdmission(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  gradeApplying: "grade_applying",
  guardianName: "guardian_name",
  guardianPhone: "guardian_phone",
  guardianEmail: "guardian_email",
  address: "address",
  source: "source",
  status: "status",
  notes: "notes",
  sectionId: "section_id",
};

export async function updateAdmission(
  id: string,
  input: z.infer<typeof updateAdmissionSchema>,
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
    `UPDATE admission_applications SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Application not found");
  return getAdmission(id, institutionId);
}

export async function deleteAdmission(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM admission_applications WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Application not found");
}

/**
 * Enroll an admitted applicant: create the real students row (reusing the
 * students service, so admission-number generation + plan limits all apply),
 * then mark the application enrolled and link it to the new student.
 */
export async function convertToStudent(
  id: string,
  input: z.infer<typeof convertAdmissionSchema>,
  institutionId: string
) {
  const application = await getAdmission(id, institutionId);
  if (application.studentId) {
    throw ApiError.badRequest("This application has already been enrolled");
  }
  const student = await createStudent(
    {
      admissionNo: input.admissionNo,
      firstName: application.firstName,
      lastName: application.lastName,
      dateOfBirth: application.dateOfBirth ?? undefined,
      gender: application.gender ?? undefined,
      sectionId: input.sectionId ?? application.sectionId ?? undefined,
      guardianName: application.guardianName ?? undefined,
      guardianPhone: application.guardianPhone ?? undefined,
      guardianEmail: application.guardianEmail ?? undefined,
      address: application.address ?? undefined,
    },
    institutionId
  );
  await query(
    `UPDATE admission_applications
     SET status = 'enrolled', student_id = $1, updated_at = now()
     WHERE id = $2 AND institution_id = $3`,
    [student.id, id, institutionId]
  );
  return { student, application: await getAdmission(id, institutionId) };
}

/** Public enquiry: resolve the school by code and record a new enquiry. */
export async function createPublicEnquiry(
  input: z.infer<typeof publicEnquirySchema>
) {
  const inst = await query<{ id: string }>(
    "SELECT id FROM institutions WHERE code = $1",
    [input.institutionCode]
  );
  if (!inst.rows[0]) {
    throw ApiError.notFound("No school found for that code");
  }
  const { rows } = await query<{ id: string }>(
    `INSERT INTO admission_applications (
       institution_id, first_name, last_name, date_of_birth, gender, grade_applying,
       guardian_name, guardian_phone, guardian_email, address, source, status, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'website','enquiry',$11)
     RETURNING id`,
    [
      inst.rows[0].id,
      input.firstName,
      input.lastName,
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.gradeApplying ?? null,
      input.guardianName ?? null,
      input.guardianPhone ?? null,
      input.guardianEmail ?? null,
      input.address ?? null,
      input.notes ?? null,
    ]
  );
  return { id: rows[0].id, status: "enquiry" as const };
}
