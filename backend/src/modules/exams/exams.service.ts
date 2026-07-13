import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { createExamSchema, upsertResultsSchema } from "./exams.schema";

export async function listExams(institutionId: string) {
  const { rows } = await query(
    `SELECT e.id, e.name, e.academic_year_id AS "academicYearId",
            ay.name AS "academicYearName",
            e.start_date AS "startDate", e.end_date AS "endDate"
     FROM exams e
     LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE e.institution_id = $1
     ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function createExam(
  input: z.infer<typeof createExamSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO exams (institution_id, name, academic_year_id, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, academic_year_id AS "academicYearId",
               start_date AS "startDate", end_date AS "endDate"`,
    [
      institutionId,
      input.name,
      input.academicYearId ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
    ]
  );
  return rows[0];
}

export async function upsertResults(
  examId: string,
  input: z.infer<typeof upsertResultsSchema>,
  institutionId: string
) {
  const { rows } = await query(
    "SELECT id FROM exams WHERE id = $1 AND institution_id = $2",
    [examId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Exam not found");

  // Every student/subject referenced MUST belong to the tenant — otherwise a
  // foreign UUID could be stored under this tenant's exam and its name echoed
  // back on read. Validate the distinct sets up front.
  const studentIds = [...new Set(input.results.map((r) => r.studentId))];
  const subjectIds = [...new Set(input.results.map((r) => r.subjectId))];
  if (studentIds.length) {
    const { rows: v } = await query<{ id: string }>(
      "SELECT id FROM students WHERE institution_id = $1 AND id = ANY($2::uuid[])",
      [institutionId, studentIds]
    );
    if (v.length !== studentIds.length)
      throw ApiError.badRequest("One or more students are not in this institution");
  }
  if (subjectIds.length) {
    const { rows: v } = await query<{ id: string }>(
      "SELECT id FROM subjects WHERE institution_id = $1 AND id = ANY($2::uuid[])",
      [institutionId, subjectIds]
    );
    if (v.length !== subjectIds.length)
      throw ApiError.badRequest("One or more subjects are not in this institution");
  }

  return withTransaction(async (client) => {
    let upserted = 0;
    for (const result of input.results) {
      await client.query(
        `INSERT INTO exam_results
           (institution_id, exam_id, student_id, subject_id, marks_obtained, max_marks, grade, remarks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (exam_id, student_id, subject_id)
         DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained,
                       max_marks = EXCLUDED.max_marks,
                       grade = EXCLUDED.grade,
                       remarks = EXCLUDED.remarks`,
        [
          institutionId,
          examId,
          result.studentId,
          result.subjectId,
          result.marksObtained,
          result.maxMarks ?? 100,
          result.grade ?? null,
          result.remarks ?? null,
        ]
      );
      upserted += 1;
    }
    return { examId, upserted };
  });
}

export async function examResults(
  examId: string,
  sectionId: string | undefined,
  institutionId: string,
  // When non-null, narrows results to these sections (teacher own-class
  // scoping). An empty array yields no rows — the caller owns no sections.
  allowedSectionIds: string[] | null = null
) {
  const params: unknown[] = [examId, institutionId];
  let sectionFilter = "";
  if (sectionId) {
    params.push(sectionId);
    sectionFilter = `AND s.section_id = $${params.length}`;
  }
  if (allowedSectionIds !== null) {
    params.push(allowedSectionIds);
    sectionFilter += ` AND s.section_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await query(
    `SELECT er.student_id AS "studentId",
            s.first_name AS "firstName",
            s.last_name AS "lastName",
            s.admission_no AS "admissionNo",
            sub.name AS "subjectName",
            er.marks_obtained AS "marksObtained",
            er.max_marks AS "maxMarks",
            er.grade
     FROM exam_results er
     JOIN students s ON s.id = er.student_id AND s.institution_id = er.institution_id
     JOIN subjects sub ON sub.id = er.subject_id AND sub.institution_id = er.institution_id
     WHERE er.exam_id = $1 AND er.institution_id = $2 ${sectionFilter}
     ORDER BY s.first_name, sub.name`,
    params
  );
  return rows;
}

export async function studentReport(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT e.name AS "examName",
            sub.name AS "subjectName",
            er.marks_obtained AS "marksObtained",
            er.max_marks AS "maxMarks",
            er.grade,
            er.remarks
     FROM exam_results er
     JOIN exams e ON e.id = er.exam_id AND e.institution_id = er.institution_id
     JOIN subjects sub ON sub.id = er.subject_id AND sub.institution_id = er.institution_id
     WHERE er.student_id = $1 AND er.institution_id = $2
     ORDER BY e.start_date DESC NULLS LAST, sub.name`,
    [studentId, institutionId]
  );
  return rows;
}
