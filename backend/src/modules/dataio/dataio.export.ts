// PR-T5 — exportable entities for the tenant Import/Export center.
//
// Each export is a read-only, tenant-scoped projection. `sensitive` datasets
// (PII / money / marks / audit) require a reason + audit before download and are
// additionally gated by a per-entity read permission composed on top of
// data_io:export. Non-sensitive setup exports need only data_io:export so
// day-to-day pulls are never blocked unnecessarily. Column lists are explicit —
// no secrets (password hashes, gateway keys) are ever selected. The engine
// applies formula-injection sanitisation to every cell.

import { query } from "../../db/postgres";
import type { Cell } from "../../utils/spreadsheet";
import type { ExportEntity } from "./dataio.types";

/** Build a simple export entity from a header list + a tenant-scoped SQL query. */
function sql(
  key: string,
  label: string,
  appliesTo: ExportEntity["appliesTo"],
  permission: string,
  sensitive: boolean,
  headers: string[],
  queryText: string
): ExportEntity {
  return {
    key, label, appliesTo, permission, sensitive, headers,
    async fetch(institutionId: string): Promise<Cell[][]> {
      const { rows } = await query<Record<string, Cell>>(queryText, [institutionId]);
      return rows.map((r) => headers.map((_, i) => r[`c${i}`]));
    },
  };
}

export const EXPORT_ENTITIES: ExportEntity[] = [
  // --- Academic setup (low sensitivity) ---
  sql("classes", "Classes", "school", "", false,
    ["Name", "Grade Level"],
    `SELECT name AS c0, grade_level AS c1 FROM classes WHERE institution_id = $1 ORDER BY grade_level, name`),
  sql("sections", "Sections", "school", "", false,
    ["Class", "Section", "Capacity"],
    `SELECT c.name AS c0, sec.name AS c1, sec.capacity AS c2
     FROM sections sec JOIN classes c ON c.id = sec.class_id
     WHERE sec.institution_id = $1 ORDER BY c.name, sec.name`),
  sql("subjects", "Subjects / Courses", "both", "", false,
    ["Name", "Code"],
    `SELECT name AS c0, code AS c1 FROM subjects WHERE institution_id = $1 ORDER BY code`),
  sql("departments", "Departments (College)", "college", "", false,
    ["Name", "Code"],
    `SELECT name AS c0, code AS c1 FROM departments WHERE institution_id = $1 ORDER BY code`),
  sql("programs", "Programs (College)", "college", "", false,
    ["Department", "Program", "Code", "Duration (semesters)"],
    `SELECT d.code AS c0, p.name AS c1, p.code AS c2, p.duration_semesters AS c3
     FROM programs p JOIN departments d ON d.id = p.department_id
     WHERE p.institution_id = $1 ORDER BY d.code, p.code`),
  sql("semesters", "Semesters (College)", "college", "", false,
    ["Program", "Semester", "Number"],
    `SELECT p.code AS c0, s.name AS c1, s.number AS c2
     FROM semesters s JOIN programs p ON p.id = s.program_id
     WHERE s.institution_id = $1 ORDER BY p.code, s.number`),
  sql("batches", "Batches (College)", "college", "", false,
    ["Program", "Batch", "Start Year"],
    `SELECT p.code AS c0, b.name AS c1, b.start_year AS c2
     FROM batches b JOIN programs p ON p.id = b.program_id
     WHERE b.institution_id = $1 ORDER BY p.code, b.name`),
  sql("courses", "Program Courses (College)", "college", "", false,
    ["Program", "Subject", "Semester #", "Credits"],
    `SELECT p.code AS c0, sub.code AS c1, s.number AS c2, ps.credits AS c3
     FROM program_subjects ps
     JOIN programs p ON p.id = ps.program_id
     JOIN subjects sub ON sub.id = ps.subject_id
     LEFT JOIN semesters s ON s.id = ps.semester_id
     WHERE ps.institution_id = $1 ORDER BY p.code, s.number NULLS FIRST, sub.code`),

  // --- People (PII / sensitive) ---
  sql("students", "Students", "both", "students:read", true,
    ["Admission No", "First Name", "Last Name", "Gender", "Date of Birth", "Section", "Guardian", "Guardian Phone", "Status"],
    `SELECT s.admission_no AS c0, s.first_name AS c1, s.last_name AS c2, s.gender AS c3,
            s.date_of_birth AS c4, sec.name AS c5, s.guardian_name AS c6, s.guardian_phone AS c7, s.status AS c8
     FROM students s LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.institution_id = $1 ORDER BY s.admission_no`),
  sql("guardians", "Guardians / Parents (links)", "both", "students:read", true,
    ["Student Admission No", "Student Name", "Parent Email", "Relationship"],
    `SELECT st.admission_no AS c0, st.first_name || ' ' || st.last_name AS c1, u.email AS c2, g.relationship AS c3
     FROM guardians g JOIN students st ON st.id = g.student_id JOIN users u ON u.id = g.user_id
     WHERE g.institution_id = $1 ORDER BY st.admission_no`),
  sql("teachers", "Teachers / Faculty & Staff", "both", "", true,
    ["Employee No", "First Name", "Last Name", "Email", "Phone", "Qualification", "Staff Type", "Designation", "Department", "Active"],
    `SELECT employee_no AS c0, first_name AS c1, last_name AS c2, email AS c3, phone AS c4, qualification AS c5,
            staff_type AS c6, designation AS c7, department AS c8, is_active AS c9
     FROM teachers WHERE institution_id = $1 ORDER BY employee_no`),
  sql("enrollments", "Enrollments (College)", "college", "", true,
    ["Admission No", "Student", "Program", "Semester #", "Batch", "Status"],
    `SELECT st.admission_no AS c0, st.first_name || ' ' || st.last_name AS c1, p.code AS c2,
            s.number AS c3, b.name AS c4, e.status AS c5
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN programs p ON p.id = e.program_id
     LEFT JOIN semesters s ON s.id = e.semester_id
     LEFT JOIN batches b ON b.id = e.batch_id
     WHERE e.institution_id = $1 ORDER BY p.code, st.admission_no`),

  // --- Operational summaries (sensitive) ---
  sql("attendance_summary", "Attendance Summary (per student)", "both", "attendance:read", true,
    ["Admission No", "Student", "Days Recorded", "Days Present", "Attendance %"],
    `SELECT st.admission_no AS c0, st.first_name || ' ' || st.last_name AS c1,
            count(ar.id) AS c2,
            count(ar.id) FILTER (WHERE ar.status IN ('present','late')) AS c3,
            CASE WHEN count(ar.id) > 0
              THEN round(100.0 * count(ar.id) FILTER (WHERE ar.status IN ('present','late')) / count(ar.id), 1)
              ELSE 0 END AS c4
     FROM students st
     LEFT JOIN attendance_records ar ON ar.student_id = st.id AND ar.institution_id = $1
     WHERE st.institution_id = $1 AND st.status = 'active'
     GROUP BY st.id, st.admission_no, st.first_name, st.last_name
     ORDER BY st.admission_no`),
  sql("fees_dues", "Fees Dues / Summary (per student)", "both", "fees:read", true,
    ["Admission No", "Student", "Invoiced", "Collected", "Outstanding"],
    `SELECT st.admission_no AS c0, st.first_name || ' ' || st.last_name AS c1,
            COALESCE(inv.invoiced, 0) AS c2, COALESCE(pay.collected, 0) AS c3,
            GREATEST(COALESCE(inv.invoiced, 0) - COALESCE(pay.collected, 0), 0) AS c4
     FROM students st
     LEFT JOIN (
       SELECT student_id, sum(amount_due) AS invoiced FROM invoices
       WHERE institution_id = $1 AND status <> 'cancelled' GROUP BY student_id
     ) inv ON inv.student_id = st.id
     LEFT JOIN (
       SELECT i.student_id, sum(p.amount) AS collected FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.institution_id = $1 GROUP BY i.student_id
     ) pay ON pay.student_id = st.id
     WHERE st.institution_id = $1 AND st.status = 'active'
     ORDER BY st.admission_no`),
  sql("exam_results", "Exam Results", "both", "reports:read", true,
    ["Exam", "Admission No", "Student", "Subject", "Marks", "Max", "Grade"],
    `SELECT e.name AS c0, st.admission_no AS c1, st.first_name || ' ' || st.last_name AS c2,
            sub.code AS c3, er.marks_obtained AS c4, er.max_marks AS c5, er.grade AS c6
     FROM exam_results er
     JOIN exams e ON e.id = er.exam_id
     JOIN students st ON st.id = er.student_id
     JOIN subjects sub ON sub.id = er.subject_id
     WHERE e.institution_id = $1 ORDER BY e.name, st.admission_no, sub.code`),

  // --- Governance (sensitive) ---
  sql("audit", "Tenant RBAC Audit Log", "both", "tenant_rbac:read", true,
    ["When", "Actor", "Action", "Target Role", "Reason"],
    `SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI') AS c0, actor_email AS c1, action AS c2,
            target_role AS c3, reason AS c4
     FROM tenant_rbac_audit WHERE institution_id = $1 ORDER BY created_at DESC LIMIT 5000`),
];

export const EXPORT_BY_KEY: Record<string, ExportEntity> = Object.fromEntries(
  EXPORT_ENTITIES.map((e) => [e.key, e])
);
