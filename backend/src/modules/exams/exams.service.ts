import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { createExamSchema, upsertResultsSchema } from "./exams.schema";

export async function listExams() {
  const { rows } = await query(
    `SELECT e.id, e.name, e.academic_year_id AS "academicYearId",
            ay.name AS "academicYearName",
            e.start_date AS "startDate", e.end_date AS "endDate"
     FROM exams e
     LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
     ORDER BY e.start_date DESC NULLS LAST, e.created_at DESC`
  );
  return rows;
}

export async function createExam(input: z.infer<typeof createExamSchema>) {
  const { rows } = await query(
    `INSERT INTO exams (name, academic_year_id, start_date, end_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, academic_year_id AS "academicYearId",
               start_date AS "startDate", end_date AS "endDate"`,
    [
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
  input: z.infer<typeof upsertResultsSchema>
) {
  const { rows } = await query("SELECT id FROM exams WHERE id = $1", [examId]);
  if (!rows[0]) throw ApiError.notFound("Exam not found");

  return withTransaction(async (client) => {
    let upserted = 0;
    for (const result of input.results) {
      await client.query(
        `INSERT INTO exam_results
           (exam_id, student_id, subject_id, marks_obtained, max_marks, grade, remarks)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (exam_id, student_id, subject_id)
         DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained,
                       max_marks = EXCLUDED.max_marks,
                       grade = EXCLUDED.grade,
                       remarks = EXCLUDED.remarks`,
        [
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

export async function examResults(examId: string, sectionId?: string) {
  const params: unknown[] = [examId];
  let sectionFilter = "";
  if (sectionId) {
    params.push(sectionId);
    sectionFilter = "AND s.section_id = $2";
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
     JOIN students s ON s.id = er.student_id
     JOIN subjects sub ON sub.id = er.subject_id
     WHERE er.exam_id = $1 ${sectionFilter}
     ORDER BY s.first_name, sub.name`,
    params
  );
  return rows;
}

export async function studentReport(studentId: string) {
  const { rows } = await query(
    `SELECT e.name AS "examName",
            sub.name AS "subjectName",
            er.marks_obtained AS "marksObtained",
            er.max_marks AS "maxMarks",
            er.grade,
            er.remarks
     FROM exam_results er
     JOIN exams e ON e.id = er.exam_id
     JOIN subjects sub ON sub.id = er.subject_id
     WHERE er.student_id = $1
     ORDER BY e.start_date DESC NULLS LAST, sub.name`,
    [studentId]
  );
  return rows;
}
