import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { assertTeachingStaff } from "../teachers/teachers.service";
import { invalidateInstitutionTypeCache } from "../../middleware/institution-type";
import type { z } from "zod";
import type {
  createBatchSchema,
  createDepartmentSchema,
  createEnrollmentSchema,
  createProgramSchema,
  createProgramSubjectSchema,
  createSemesterSchema,
  createStaffAllocationSchema,
  updateDepartmentSchema,
  updateEnrollmentSchema,
  updateProgramSchema,
  updateSemesterSchema,
} from "./college.schema";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

async function assertRef(
  table: "departments" | "programs" | "semesters" | "subjects" | "students" | "teachers" | "batches",
  id: string,
  institutionId: string,
  label: string
): Promise<void> {
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest(`Invalid ${label}`);
}

function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    const v = input[field];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

// --- Settings / overview ---

/**
 * Switches the requester's own institution between school and college mode.
 * Tenant-scoped: only the caller's institution_id is ever touched, so a college
 * admin can enable college features without exposing the super-admin console.
 */
export async function setInstitutionType(
  institutionId: string,
  type: "school" | "college"
) {
  const { rows } = await query(
    `UPDATE institutions SET type = $2 WHERE id = $1 RETURNING id, name, type`,
    [institutionId, type]
  );
  if (!rows[0]) throw ApiError.notFound("Institution not found");
  // The type guard caches institution type briefly; bust it so the switch
  // takes effect immediately for subsequent requests.
  invalidateInstitutionTypeCache(institutionId);
  return rows[0];
}

export async function overview(institutionId: string) {
  const { rows } = await query<{
    type: string;
    departments: number;
    programs: number;
    semesters: number;
    enrollments: number;
  }>(
    `SELECT (SELECT type FROM institutions WHERE id = $1) AS type,
            (SELECT count(*)::int FROM departments WHERE institution_id = $1) AS departments,
            (SELECT count(*)::int FROM programs WHERE institution_id = $1) AS programs,
            (SELECT count(*)::int FROM semesters WHERE institution_id = $1) AS semesters,
            (SELECT count(*)::int FROM enrollments WHERE institution_id = $1) AS enrollments`,
    [institutionId]
  );
  return rows[0];
}

// --- Departments ---

export async function listDepartments(institutionId: string) {
  const { rows } = await query(
    `SELECT d.id, d.name, d.code, d.head_teacher_id AS "headTeacherId",
            CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS "headTeacherName",
            (SELECT count(*)::int FROM programs p WHERE p.department_id = d.id) AS "programCount"
     FROM departments d LEFT JOIN teachers t ON t.id = d.head_teacher_id
     WHERE d.institution_id = $1 ORDER BY d.name`,
    [institutionId]
  );
  return rows;
}

export async function createDepartment(
  input: z.infer<typeof createDepartmentSchema>,
  institutionId: string
) {
  if (input.headTeacherId)
    await assertTeachingStaff(input.headTeacherId, institutionId);
  try {
    const { rows } = await query(
      `INSERT INTO departments (institution_id, name, code, head_teacher_id)
       VALUES ($1, $2, $3, $4) RETURNING id, name, code, head_teacher_id AS "headTeacherId"`,
      [institutionId, input.name, input.code, input.headTeacherId ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A department with that code exists");
    throw err;
  }
}

export async function updateDepartment(
  id: string,
  input: z.infer<typeof updateDepartmentSchema>,
  institutionId: string
) {
  if (input.headTeacherId)
    await assertTeachingStaff(input.headTeacherId, institutionId);
  const { sets, params } = buildSets(
    { name: "name", code: "code", headTeacherId: "head_teacher_id" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE departments SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, name, code, head_teacher_id AS "headTeacherId"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Department not found");
  return rows[0];
}

export async function deleteDepartment(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM departments WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Department not found");
}

// --- Programs ---

export async function listPrograms(institutionId: string, departmentId?: string) {
  const params: unknown[] = [institutionId];
  let where = "p.institution_id = $1";
  if (departmentId) {
    params.push(departmentId);
    where += ` AND p.department_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT p.id, p.name, p.code, p.department_id AS "departmentId", d.name AS "departmentName",
            p.duration_semesters AS "durationSemesters"
     FROM programs p JOIN departments d ON d.id = p.department_id
     WHERE ${where} ORDER BY p.name`,
    params
  );
  return rows;
}

export async function createProgram(
  input: z.infer<typeof createProgramSchema>,
  institutionId: string
) {
  await assertRef("departments", input.departmentId, institutionId, "department");
  try {
    const { rows } = await query(
      `INSERT INTO programs (institution_id, department_id, name, code, duration_semesters)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, code, department_id AS "departmentId", duration_semesters AS "durationSemesters"`,
      [institutionId, input.departmentId, input.name, input.code, input.durationSemesters ?? 6]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A program with that code exists");
    throw err;
  }
}

export async function updateProgram(
  id: string,
  input: z.infer<typeof updateProgramSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    { name: "name", code: "code", durationSemesters: "duration_semesters" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE programs SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, name, code, department_id AS "departmentId", duration_semesters AS "durationSemesters"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Program not found");
  return rows[0];
}

export async function deleteProgram(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM programs WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Program not found");
}

// --- Semesters ---

export async function listSemesters(institutionId: string, programId?: string) {
  const params: unknown[] = [institutionId];
  let where = "s.institution_id = $1";
  if (programId) {
    params.push(programId);
    where += ` AND s.program_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT s.id, s.name, s.number, s.program_id AS "programId", pr.name AS "programName",
            s.academic_year_id AS "academicYearId", s.start_date AS "startDate", s.end_date AS "endDate"
     FROM semesters s JOIN programs pr ON pr.id = s.program_id
     WHERE ${where} ORDER BY pr.name, s.number`,
    params
  );
  return rows;
}

export async function createSemester(
  input: z.infer<typeof createSemesterSchema>,
  institutionId: string
) {
  await assertRef("programs", input.programId, institutionId, "program");
  try {
    const { rows } = await query(
      `INSERT INTO semesters (institution_id, program_id, name, number, academic_year_id, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, number, program_id AS "programId"`,
      [
        institutionId,
        input.programId,
        input.name,
        input.number,
        input.academicYearId ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err))
      throw ApiError.conflict("That semester number already exists for the program");
    throw err;
  }
}

export async function updateSemester(
  id: string,
  input: z.infer<typeof updateSemesterSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      name: "name",
      number: "number",
      academicYearId: "academic_year_id",
      startDate: "start_date",
      endDate: "end_date",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE semesters SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, name, number, program_id AS "programId"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Semester not found");
  return rows[0];
}

export async function deleteSemester(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM semesters WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Semester not found");
}

// --- Batches ---

export async function listBatches(institutionId: string, programId?: string) {
  const params: unknown[] = [institutionId];
  let where = "institution_id = $1";
  if (programId) {
    params.push(programId);
    where += ` AND program_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT id, name, start_year AS "startYear", program_id AS "programId"
     FROM batches WHERE ${where} ORDER BY name`,
    params
  );
  return rows;
}

export async function createBatch(
  input: z.infer<typeof createBatchSchema>,
  institutionId: string
) {
  await assertRef("programs", input.programId, institutionId, "program");
  try {
    const { rows } = await query(
      `INSERT INTO batches (institution_id, program_id, name, start_year)
       VALUES ($1, $2, $3, $4) RETURNING id, name, start_year AS "startYear", program_id AS "programId"`,
      [institutionId, input.programId, input.name, input.startYear ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That batch already exists for the program");
    throw err;
  }
}

export async function deleteBatch(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM batches WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Batch not found");
}

// --- Program subjects ---

export async function listProgramSubjects(
  institutionId: string,
  filters: { programId?: string; semesterId?: string }
) {
  const params: unknown[] = [institutionId];
  let where = "ps.institution_id = $1";
  if (filters.programId) {
    params.push(filters.programId);
    where += ` AND ps.program_id = $${params.length}`;
  }
  if (filters.semesterId) {
    params.push(filters.semesterId);
    where += ` AND ps.semester_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ps.id, ps.program_id AS "programId", ps.semester_id AS "semesterId",
            sem.name AS "semesterName", ps.subject_id AS "subjectId", sub.name AS "subjectName",
            ps.credits
     FROM program_subjects ps
     JOIN subjects sub ON sub.id = ps.subject_id
     LEFT JOIN semesters sem ON sem.id = ps.semester_id
     WHERE ${where} ORDER BY sem.number NULLS FIRST, sub.name`,
    params
  );
  return rows;
}

export async function createProgramSubject(
  input: z.infer<typeof createProgramSubjectSchema>,
  institutionId: string
) {
  await assertRef("programs", input.programId, institutionId, "program");
  await assertRef("subjects", input.subjectId, institutionId, "subject");
  if (input.semesterId)
    await assertRef("semesters", input.semesterId, institutionId, "semester");
  try {
    const { rows } = await query(
      `INSERT INTO program_subjects (institution_id, program_id, semester_id, subject_id, credits)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, program_id AS "programId", semester_id AS "semesterId", subject_id AS "subjectId", credits`,
      [institutionId, input.programId, input.semesterId ?? null, input.subjectId, input.credits ?? 3]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That subject is already mapped to the semester");
    throw err;
  }
}

export async function deleteProgramSubject(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM program_subjects WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Program subject not found");
}

// --- Enrollments ---

export async function listEnrollments(
  institutionId: string,
  filters: { programId?: string; semesterId?: string }
) {
  const params: unknown[] = [institutionId];
  let where = "e.institution_id = $1";
  if (filters.programId) {
    params.push(filters.programId);
    where += ` AND e.program_id = $${params.length}`;
  }
  if (filters.semesterId) {
    params.push(filters.semesterId);
    where += ` AND e.semester_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT e.id, e.student_id AS "studentId", s.first_name || ' ' || s.last_name AS "studentName",
            s.admission_no AS "admissionNo", e.program_id AS "programId", pr.name AS "programName",
            e.semester_id AS "semesterId", sem.name AS "semesterName", e.batch_id AS "batchId", e.status
     FROM enrollments e
     JOIN students s ON s.id = e.student_id
     JOIN programs pr ON pr.id = e.program_id
     LEFT JOIN semesters sem ON sem.id = e.semester_id
     WHERE ${where} ORDER BY s.first_name, s.last_name`,
    params
  );
  return rows;
}

export async function createEnrollment(
  input: z.infer<typeof createEnrollmentSchema>,
  institutionId: string
) {
  await assertRef("students", input.studentId, institutionId, "student");
  await assertRef("programs", input.programId, institutionId, "program");
  if (input.semesterId)
    await assertRef("semesters", input.semesterId, institutionId, "semester");
  if (input.batchId) await assertRef("batches", input.batchId, institutionId, "batch");
  try {
    const { rows } = await query(
      `INSERT INTO enrollments (institution_id, student_id, program_id, semester_id, batch_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, student_id AS "studentId", program_id AS "programId",
                 semester_id AS "semesterId", batch_id AS "batchId", status`,
      [
        institutionId,
        input.studentId,
        input.programId,
        input.semesterId ?? null,
        input.batchId ?? null,
        input.status ?? "active",
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err))
      throw ApiError.conflict("That student is already enrolled in the program");
    throw err;
  }
}

export async function updateEnrollment(
  id: string,
  input: z.infer<typeof updateEnrollmentSchema>,
  institutionId: string
) {
  if (input.semesterId)
    await assertRef("semesters", input.semesterId, institutionId, "semester");
  if (input.batchId) await assertRef("batches", input.batchId, institutionId, "batch");
  const { sets, params } = buildSets(
    { semesterId: "semester_id", batchId: "batch_id", status: "status" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE enrollments SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, student_id AS "studentId", program_id AS "programId",
               semester_id AS "semesterId", batch_id AS "batchId", status`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Enrollment not found");
  return rows[0];
}

export async function deleteEnrollment(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM enrollments WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Enrollment not found");
}

// --- Staff allocations ---

export async function listStaffAllocations(
  institutionId: string,
  filters: { teacherId?: string; programId?: string }
) {
  const params: unknown[] = [institutionId];
  let where = "a.institution_id = $1";
  if (filters.teacherId) {
    params.push(filters.teacherId);
    where += ` AND a.teacher_id = $${params.length}`;
  }
  if (filters.programId) {
    params.push(filters.programId);
    where += ` AND a.program_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT a.id, a.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            a.department_id AS "departmentId", d.name AS "departmentName",
            a.program_id AS "programId", pr.name AS "programName",
            a.subject_id AS "subjectId", sub.name AS "subjectName"
     FROM staff_allocations a
     JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN departments d ON d.id = a.department_id
     LEFT JOIN programs pr ON pr.id = a.program_id
     LEFT JOIN subjects sub ON sub.id = a.subject_id
     WHERE ${where} ORDER BY t.first_name, t.last_name`,
    params
  );
  return rows;
}

export async function createStaffAllocation(
  input: z.infer<typeof createStaffAllocationSchema>,
  institutionId: string
) {
  await assertTeachingStaff(input.teacherId, institutionId);
  if (input.departmentId)
    await assertRef("departments", input.departmentId, institutionId, "department");
  if (input.programId) await assertRef("programs", input.programId, institutionId, "program");
  if (input.subjectId) await assertRef("subjects", input.subjectId, institutionId, "subject");
  const { rows } = await query(
    `INSERT INTO staff_allocations (institution_id, teacher_id, department_id, program_id, subject_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, teacher_id AS "teacherId", department_id AS "departmentId",
               program_id AS "programId", subject_id AS "subjectId"`,
    [
      institutionId,
      input.teacherId,
      input.departmentId ?? null,
      input.programId ?? null,
      input.subjectId ?? null,
    ]
  );
  return rows[0];
}

export async function deleteStaffAllocation(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM staff_allocations WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Allocation not found");
}

// --- GPA / CGPA foundation ---

interface BandRow {
  grade: string;
  min_percent: string;
  max_percent: string;
  grade_point: string | null;
}

function gradePointFor(bands: BandRow[], percent: number): { grade: string; gp: number } {
  for (const b of bands) {
    if (percent >= Number(b.min_percent) && percent <= Number(b.max_percent)) {
      const gp =
        b.grade_point != null
          ? Number(b.grade_point)
          : Math.min(10, Math.round(Number(b.min_percent) / 10));
      return { grade: b.grade, gp };
    }
  }
  return { grade: "-", gp: 0 };
}

async function loadBands(institutionId: string): Promise<BandRow[]> {
  const { rows } = await query<BandRow>(
    `SELECT grade, min_percent, max_percent, grade_point FROM grade_bands
     WHERE institution_id = $1 ORDER BY min_percent DESC`,
    [institutionId]
  );
  return rows;
}

interface SubjectGrade {
  subject: string;
  credits: number;
  percent: number;
  grade: string;
  gradePoint: number;
}

async function computeSemester(
  studentId: string,
  semesterId: string,
  bands: BandRow[],
  institutionId: string
): Promise<{ subjects: SubjectGrade[]; credits: number; weighted: number }> {
  const { rows: results } = await query<{
    subject_id: string;
    subject: string;
    marks: number;
    max: number;
  }>(
    `SELECT er.subject_id, sub.name AS subject, er.marks_obtained::float AS marks, er.max_marks::float AS max
     FROM exam_results er
     JOIN exams e ON e.id = er.exam_id
     JOIN subjects sub ON sub.id = er.subject_id
     WHERE er.institution_id = $1 AND er.student_id = $2 AND e.semester_id = $3`,
    [institutionId, studentId, semesterId]
  );
  const { rows: creditRows } = await query<{ subject_id: string; credits: string }>(
    `SELECT subject_id, credits FROM program_subjects
     WHERE institution_id = $1 AND semester_id = $2`,
    [institutionId, semesterId]
  );
  const creditMap = new Map(creditRows.map((r) => [r.subject_id, Number(r.credits)]));

  // Average percentage per subject (a subject may have multiple exam rows).
  const bySubject = new Map<string, { subject: string; pcts: number[] }>();
  for (const r of results) {
    const pct = r.max > 0 ? (r.marks / r.max) * 100 : 0;
    if (!bySubject.has(r.subject_id))
      bySubject.set(r.subject_id, { subject: r.subject, pcts: [] });
    bySubject.get(r.subject_id)!.pcts.push(pct);
  }

  const subjects: SubjectGrade[] = [];
  let credits = 0;
  let weighted = 0;
  for (const [subjectId, info] of bySubject) {
    const percent = info.pcts.reduce((a, b) => a + b, 0) / info.pcts.length;
    const { grade, gp } = gradePointFor(bands, percent);
    const cr = creditMap.get(subjectId) ?? 0;
    credits += cr;
    weighted += cr * gp;
    subjects.push({
      subject: info.subject,
      credits: cr,
      percent: Math.round(percent * 100) / 100,
      grade,
      gradePoint: gp,
    });
  }
  return { subjects, credits, weighted };
}

export async function semesterResult(
  studentId: string,
  semesterId: string,
  institutionId: string
) {
  const sem = await query(
    "SELECT name FROM semesters WHERE id = $1 AND institution_id = $2",
    [semesterId, institutionId]
  );
  if (!sem.rows[0]) throw ApiError.notFound("Semester not found");
  const bands = await loadBands(institutionId);
  const { subjects, credits, weighted } = await computeSemester(
    studentId,
    semesterId,
    bands,
    institutionId
  );
  return {
    semesterId,
    semesterName: (sem.rows[0] as { name: string }).name,
    subjects,
    totalCredits: credits,
    gpa: credits > 0 ? Math.round((weighted / credits) * 100) / 100 : null,
  };
}

export async function cgpa(
  studentId: string,
  programId: string,
  institutionId: string
) {
  const { rows: sems } = await query<{ id: string }>(
    "SELECT id FROM semesters WHERE program_id = $1 AND institution_id = $2 ORDER BY number",
    [programId, institutionId]
  );
  const bands = await loadBands(institutionId);
  let credits = 0;
  let weighted = 0;
  const perSemester: Array<{ semesterId: string; gpa: number | null }> = [];
  for (const s of sems) {
    const r = await computeSemester(studentId, s.id, bands, institutionId);
    perSemester.push({
      semesterId: s.id,
      gpa: r.credits > 0 ? Math.round((r.weighted / r.credits) * 100) / 100 : null,
    });
    credits += r.credits;
    weighted += r.weighted;
  }
  return {
    programId,
    cgpa: credits > 0 ? Math.round((weighted / credits) * 100) / 100 : null,
    totalCredits: credits,
    perSemester,
  };
}
