import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { getStudent } from "../students/students.service";
import {
  markSheetPdf,
  reportCardPdf,
  type MarkSheetData,
  type MarkSheetRow,
  type ReportCardData,
  type ReportSubject,
} from "./reports.pdf";
import type { z } from "zod";
import type {
  createGradeBandSchema,
  updateGradeBandSchema,
} from "./reports.schema";

// Minimum percentage (per subject) to count as a pass.
const PASS_PERCENT = 35;

interface BandRow {
  id: string;
  grade: string;
  min_percent: string;
  max_percent: string;
  remark: string | null;
  sort_order: number;
}

// --- Grade scale ---

export async function listGradeBands(institutionId: string) {
  const { rows } = await query(
    `SELECT id, grade, min_percent AS "minPercent", max_percent AS "maxPercent",
            remark, sort_order AS "sortOrder"
     FROM grade_bands WHERE institution_id = $1
     ORDER BY min_percent DESC`,
    [institutionId]
  );
  return rows;
}

function uniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

export async function createGradeBand(
  input: z.infer<typeof createGradeBandSchema>,
  institutionId: string
) {
  if (input.maxPercent < input.minPercent) {
    throw ApiError.badRequest("maxPercent must be ≥ minPercent");
  }
  try {
    const { rows } = await query(
      `INSERT INTO grade_bands (institution_id, grade, min_percent, max_percent, remark, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, grade, min_percent AS "minPercent", max_percent AS "maxPercent",
                 remark, sort_order AS "sortOrder"`,
      [
        institutionId,
        input.grade,
        input.minPercent,
        input.maxPercent,
        input.remark ?? null,
        input.sortOrder ?? 0,
      ]
    );
    return rows[0];
  } catch (err) {
    if (uniqueViolation(err))
      throw ApiError.conflict("A band with that grade already exists");
    throw err;
  }
}

const BAND_COLUMNS: Record<string, string> = {
  grade: "grade",
  minPercent: "min_percent",
  maxPercent: "max_percent",
  remark: "remark",
  sortOrder: "sort_order",
};

export async function updateGradeBand(
  id: string,
  input: z.infer<typeof updateGradeBandSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(BAND_COLUMNS)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE grade_bands SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, grade, min_percent AS "minPercent", max_percent AS "maxPercent",
               remark, sort_order AS "sortOrder"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Grade band not found");
  return rows[0];
}

export async function deleteGradeBand(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM grade_bands WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Grade band not found");
}

// --- Shared helpers ---

function gradeFor(
  bands: BandRow[],
  percent: number
): { grade: string; remark: string } {
  for (const b of bands) {
    if (percent >= Number(b.min_percent) && percent <= Number(b.max_percent)) {
      return { grade: b.grade, remark: b.remark ?? "" };
    }
  }
  return { grade: "-", remark: "" };
}

async function loadBands(institutionId: string): Promise<BandRow[]> {
  const { rows } = await query<BandRow>(
    `SELECT id, grade, min_percent, max_percent, remark, sort_order
     FROM grade_bands WHERE institution_id = $1 ORDER BY min_percent DESC`,
    [institutionId]
  );
  return rows;
}

async function getExam(examId: string, institutionId: string) {
  const { rows } = await query<{ name: string; academic_year: string | null }>(
    `SELECT e.name, ay.name AS academic_year
     FROM exams e LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE e.id = $1 AND e.institution_id = $2`,
    [examId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Exam not found");
  return rows[0];
}

async function institutionName(institutionId: string): Promise<string> {
  const { rows } = await query<{ name: string }>(
    "SELECT name FROM institutions WHERE id = $1",
    [institutionId]
  );
  return rows[0]?.name ?? "Institution";
}

// --- Report card ---

export async function reportCardData(
  examId: string,
  studentId: string,
  institutionId: string
): Promise<ReportCardData> {
  const exam = await getExam(examId, institutionId);
  const student = (await getStudent(studentId, institutionId)) as {
    firstName: string;
    lastName: string;
    admissionNo: string;
    className: string | null;
    sectionName: string | null;
    gender: string | null;
  };

  const { rows: results } = await query<{
    subject: string;
    marks: number;
    max: number;
    remarks: string | null;
  }>(
    `SELECT sub.name AS subject, er.marks_obtained::float AS marks,
            er.max_marks::float AS max, er.remarks
     FROM exam_results er JOIN subjects sub ON sub.id = er.subject_id
     WHERE er.exam_id = $1 AND er.student_id = $2 AND er.institution_id = $3
     ORDER BY sub.name`,
    [examId, studentId, institutionId]
  );
  if (results.length === 0) {
    throw ApiError.notFound("No results recorded for this student in this exam");
  }

  const bands = await loadBands(institutionId);
  let total = 0;
  let max = 0;
  let allPass = true;
  const subjects: ReportSubject[] = results.map((r) => {
    const percent = r.max > 0 ? (r.marks / r.max) * 100 : 0;
    if (percent < PASS_PERCENT) allPass = false;
    total += r.marks;
    max += r.max;
    const g = gradeFor(bands, percent);
    return {
      subjectName: r.subject,
      maxMarks: r.max,
      marksObtained: r.marks,
      percent,
      grade: g.grade,
      remark: r.remarks ?? g.remark,
    };
  });
  const percentage = max > 0 ? (total / max) * 100 : 0;

  const { rows: att } = await query<{ total: number; present: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present
     FROM attendance_records WHERE student_id = $1 AND institution_id = $2`,
    [studentId, institutionId]
  );
  const a = att[0];
  const attendance =
    a.total > 0
      ? { total: a.total, present: a.present, rate: Math.round((a.present / a.total) * 100) }
      : null;

  return {
    institutionName: await institutionName(institutionId),
    academicYear: exam.academic_year,
    examName: exam.name,
    student: {
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.admissionNo,
      className: student.className,
      sectionName: student.sectionName,
      gender: student.gender,
    },
    subjects,
    totals: {
      total,
      max,
      percentage,
      grade: gradeFor(bands, percentage).grade,
      result: allPass ? "PASS" : "FAIL",
    },
    attendance,
  };
}

export async function reportCardBuffer(
  examId: string,
  studentId: string,
  institutionId: string
): Promise<Buffer> {
  return reportCardPdf(await reportCardData(examId, studentId, institutionId));
}

// --- Mark sheet ---

export async function markSheetData(
  examId: string,
  sectionId: string,
  institutionId: string
): Promise<MarkSheetData> {
  const exam = await getExam(examId, institutionId);
  const { rows: secRows } = await query<{
    section_name: string;
    class_name: string;
  }>(
    `SELECT sec.name AS section_name, c.name AS class_name
     FROM sections sec JOIN classes c ON c.id = sec.class_id
     WHERE sec.id = $1 AND sec.institution_id = $2`,
    [sectionId, institutionId]
  );
  if (!secRows[0]) throw ApiError.notFound("Section not found");

  const { rows: students } = await query<{
    id: string;
    admission_no: string;
    first_name: string;
    last_name: string;
  }>(
    `SELECT id, admission_no, first_name, last_name FROM students
     WHERE institution_id = $1 AND section_id = $2 AND status <> 'archived'
     ORDER BY first_name, last_name`,
    [institutionId, sectionId]
  );

  const { rows: results } = await query<{
    student_id: string;
    subject: string;
    marks: number;
    max: number;
  }>(
    `SELECT er.student_id, sub.name AS subject, er.marks_obtained::float AS marks,
            er.max_marks::float AS max
     FROM exam_results er
     JOIN subjects sub ON sub.id = er.subject_id
     JOIN students s ON s.id = er.student_id
     WHERE er.exam_id = $1 AND er.institution_id = $2 AND s.section_id = $3`,
    [examId, institutionId, sectionId]
  );

  const subjects = [...new Set(results.map((r) => r.subject))].sort();
  const bands = await loadBands(institutionId);

  const byStudent = new Map<string, typeof results>();
  for (const r of results) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
    byStudent.get(r.student_id)!.push(r);
  }

  const rows: MarkSheetRow[] = students.map((s) => {
    const rs = byStudent.get(s.id) ?? [];
    const marks: Record<string, number | null> = {};
    for (const sub of subjects) marks[sub] = null;
    let total = 0;
    let max = 0;
    let allPass = rs.length > 0;
    for (const r of rs) {
      marks[r.subject] = r.marks;
      total += r.marks;
      max += r.max;
      const pct = r.max > 0 ? (r.marks / r.max) * 100 : 0;
      if (pct < PASS_PERCENT) allPass = false;
    }
    const percentage = max > 0 ? (total / max) * 100 : 0;
    return {
      admissionNo: s.admission_no,
      name: `${s.first_name} ${s.last_name}`,
      marks,
      total,
      max,
      percentage,
      grade: gradeFor(bands, percentage).grade,
      result: allPass ? "PASS" : "FAIL",
    };
  });

  return {
    institutionName: await institutionName(institutionId),
    academicYear: exam.academic_year,
    examName: exam.name,
    className: secRows[0].class_name,
    sectionName: secRows[0].section_name,
    subjects,
    rows,
  };
}

export async function markSheetBuffer(
  examId: string,
  sectionId: string,
  institutionId: string
): Promise<Buffer> {
  return markSheetPdf(await markSheetData(examId, sectionId, institutionId));
}
