import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";

export interface Col {
  key: string;
  label: string;
}
export interface ReportResult {
  title: string;
  columns: Col[];
  rows: Record<string, unknown>[];
}
export interface Filters {
  classId?: string;
  sectionId?: string;
  studentId?: string;
  staffId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  examId?: string;
  subjectId?: string;
  category?: string;
  ownerType?: string;
  search?: string;
  programId?: string;
  semesterId?: string;
  departmentId?: string;
}

interface Report {
  title: string;
  category: string;
  permission: string;
  run: (filters: Filters, institutionId: string) => Promise<ReportResult>;
}

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function rowsOf(
  sql: string,
  params: unknown[]
): Promise<Record<string, unknown>[]> {
  const { rows } = await query(sql, params);
  return rows as Record<string, unknown>[];
}

export const REPORTS: Record<string, Report> = {
  students: {
    title: "Student Roster",
    category: "Students",
    permission: "reports:center:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["s.institution_id = $1"];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`s.section_id = $${params.length}`);
      }
      if (f.classId) {
        params.push(f.classId);
        where.push(`c.id = $${params.length}`);
      }
      if (f.status) {
        params.push(f.status);
        where.push(`s.status = $${params.length}`);
      } else {
        where.push("s.status <> 'archived'");
      }
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS name,
                c.name AS class, sec.name AS section, s.gender,
                s.guardian_name AS guardian, s.guardian_phone AS phone, s.status
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE ${where.join(" AND ")}
         ORDER BY c.grade_level NULLS LAST, sec.name, s.first_name`,
        params
      );
      return {
        title: "Student Roster",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "name", label: "Name" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "gender", label: "Gender" },
          { key: "guardian", label: "Guardian" },
          { key: "phone", label: "Phone" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  staff: {
    title: "Staff List",
    category: "Staff",
    permission: "reports:center:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT employee_no AS "employeeNo", first_name || ' ' || last_name AS name,
                email, phone, qualification, specialization,
                is_active AS "active"
         FROM teachers WHERE institution_id = $1 ORDER BY first_name, last_name`,
        [inst]
      );
      return {
        title: "Staff List",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "qualification", label: "Qualification" },
          { key: "specialization", label: "Specialization" },
          { key: "active", label: "Active" },
        ],
        rows,
      };
    },
  },

  attendance: {
    title: "Attendance Summary",
    category: "Attendance",
    permission: "reports:attendance:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const joinConds = ["ar.student_id = s.id", "ar.institution_id = $1"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        joinConds.push(`ar.date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        joinConds.push(`ar.date <= $${params.length}`);
      }
      const where = ["s.institution_id = $1", "s.status <> 'archived'"];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`s.section_id = $${params.length}`);
      }
      const raw = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS name,
                c.name AS class, sec.name AS section,
                count(ar.id) FILTER (WHERE ar.status = 'present')::int AS present,
                count(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent,
                count(ar.id) FILTER (WHERE ar.status = 'late')::int AS late,
                count(ar.id) FILTER (WHERE ar.status = 'excused')::int AS excused,
                count(ar.id)::int AS total
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         LEFT JOIN attendance_records ar ON ${joinConds.join(" AND ")}
         WHERE ${where.join(" AND ")}
         GROUP BY s.id, s.admission_no, s.first_name, s.last_name, c.name, sec.name
         ORDER BY name`,
        params
      );
      const rows = raw.map((r) => {
        const total = Number(r.total);
        const attended = Number(r.present) + Number(r.late);
        return { ...r, rate: total > 0 ? `${Math.round((attended / total) * 100)}%` : "—" };
      });
      return {
        title: "Attendance Summary",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "name", label: "Name" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "present", label: "Present" },
          { key: "absent", label: "Absent" },
          { key: "late", label: "Late" },
          { key: "excused", label: "Excused" },
          { key: "total", label: "Total" },
          { key: "rate", label: "Rate" },
        ],
        rows,
      };
    },
  },

  fee_collection: {
    title: "Fee Collection",
    category: "Fees",
    permission: "reports:fees:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        where.push(`p.paid_at::date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        where.push(`p.paid_at::date <= $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT p.paid_at::date AS date, s.first_name || ' ' || s.last_name AS student,
                s.admission_no AS "admissionNo", i.invoice_no AS "invoiceNo",
                p.method, p.amount
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN students s ON s.id = i.student_id
         WHERE ${where.join(" AND ")}
         ORDER BY p.paid_at DESC`,
        params
      );
      return {
        title: "Fee Collection",
        columns: [
          { key: "date", label: "Date" },
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "method", label: "Method" },
          { key: "amount", label: "Amount" },
        ],
        rows,
      };
    },
  },

  fee_dues: {
    title: "Fee Dues",
    category: "Fees",
    permission: "reports:fees:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = [
        "i.institution_id = $1",
        "i.status IN ('pending', 'partially_paid')",
      ];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`s.section_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT i.invoice_no AS "invoiceNo", s.first_name || ' ' || s.last_name AS student,
                c.name AS class, sec.name AS section,
                i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
                (i.amount_due - i.amount_paid) AS outstanding,
                i.due_date AS "dueDate", i.status
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE ${where.join(" AND ")}
         ORDER BY i.due_date NULLS LAST`,
        params
      );
      return {
        title: "Fee Dues",
        columns: [
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "amountDue", label: "Amount Due" },
          { key: "amountPaid", label: "Amount Paid" },
          { key: "outstanding", label: "Outstanding" },
          { key: "dueDate", label: "Due Date" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  exam_results: {
    title: "Exam Results",
    category: "Exams",
    permission: "reports:exams:read",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "admissionNo", label: "Admission No" },
        { key: "student", label: "Student" },
        { key: "subject", label: "Subject" },
        { key: "marks", label: "Marks" },
        { key: "max", label: "Max" },
        { key: "grade", label: "Grade" },
      ];
      if (!f.examId) return { title: "Exam Results", columns, rows: [] };
      const params: unknown[] = [inst, f.examId];
      const where = ["er.institution_id = $1", "er.exam_id = $2"];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`s.section_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS student,
                sub.name AS subject, er.marks_obtained AS marks, er.max_marks AS max, er.grade
         FROM exam_results er
         JOIN students s ON s.id = er.student_id
         JOIN subjects sub ON sub.id = er.subject_id
         WHERE ${where.join(" AND ")}
         ORDER BY student, subject`,
        params
      );
      return { title: "Exam Results", columns, rows };
    },
  },

  homework: {
    title: "Homework Status",
    category: "Homework",
    permission: "reports:homework:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["h.institution_id = $1"];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`h.section_id = $${params.length}`);
      }
      if (f.subjectId) {
        params.push(f.subjectId);
        where.push(`h.subject_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT h.title, c.name AS class, sec.name AS section, subj.name AS subject,
                h.due_date AS "dueDate",
                (SELECT count(*)::int FROM homework_submissions hs WHERE hs.homework_id = h.id) AS submissions,
                (SELECT count(*)::int FROM homework_submissions hs WHERE hs.homework_id = h.id AND hs.reviewed_at IS NOT NULL) AS reviewed
         FROM homework h
         JOIN sections sec ON sec.id = h.section_id
         JOIN classes c ON c.id = sec.class_id
         JOIN subjects subj ON subj.id = h.subject_id
         WHERE ${where.join(" AND ")}
         ORDER BY h.due_date DESC NULLS LAST`,
        params
      );
      return {
        title: "Homework Status",
        columns: [
          { key: "title", label: "Title" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "subject", label: "Subject" },
          { key: "dueDate", label: "Due Date" },
          { key: "submissions", label: "Submissions" },
          { key: "reviewed", label: "Reviewed" },
        ],
        rows,
      };
    },
  },

  communication: {
    title: "Communication Delivery",
    category: "Communication",
    permission: "reports:center:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["m.institution_id = $1"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        where.push(`m.created_at::date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        where.push(`m.created_at::date <= $${params.length}`);
      }
      if (f.category) {
        params.push(f.category);
        where.push(`m.category = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT m.subject, m.category, m.audience_type AS "audience",
                m.created_at::date AS date,
                (SELECT count(*)::int FROM message_recipients r WHERE r.message_id = m.id) AS recipients,
                (SELECT count(*)::int FROM message_recipients r WHERE r.message_id = m.id AND r.read_at IS NOT NULL) AS read
         FROM messages m WHERE ${where.join(" AND ")}
         ORDER BY m.created_at DESC`,
        params
      );
      return {
        title: "Communication Delivery",
        columns: [
          { key: "date", label: "Date" },
          { key: "subject", label: "Subject" },
          { key: "category", label: "Category" },
          { key: "audience", label: "Audience" },
          { key: "recipients", label: "Recipients" },
          { key: "read", label: "Read" },
        ],
        rows,
      };
    },
  },

  documents: {
    title: "Document Uploads",
    category: "Documents",
    permission: "reports:center:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["d.institution_id = $1"];
      if (f.category) {
        params.push(f.category);
        where.push(`d.category = $${params.length}`);
      }
      if (f.ownerType) {
        params.push(f.ownerType);
        where.push(`d.owner_type = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT d.original_name AS "fileName", d.category, d.owner_type AS "ownerType",
                d.size_bytes AS "sizeBytes", d.created_at::date AS date,
                u.full_name AS "uploadedBy"
         FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
         WHERE ${where.join(" AND ")}
         ORDER BY d.created_at DESC`,
        params
      );
      return {
        title: "Document Uploads",
        columns: [
          { key: "date", label: "Date" },
          { key: "fileName", label: "File" },
          { key: "category", label: "Category" },
          { key: "ownerType", label: "Owner" },
          { key: "sizeBytes", label: "Size (bytes)" },
          { key: "uploadedBy", label: "Uploaded By" },
        ],
        rows,
      };
    },
  },

  timetable: {
    title: "Timetable",
    category: "Timetable",
    permission: "reports:center:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["te.institution_id = $1"];
      if (f.sectionId) {
        params.push(f.sectionId);
        where.push(`te.section_id = $${params.length}`);
      }
      const raw = await rowsOf(
        `SELECT te.day_of_week AS "dayNum", p.name AS period,
                c.name AS class, sec.name AS section, subj.name AS subject,
                CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS teacher,
                r.name AS room
         FROM timetable_entries te
         JOIN periods p ON p.id = te.period_id
         JOIN sections sec ON sec.id = te.section_id
         JOIN classes c ON c.id = sec.class_id
         JOIN subjects subj ON subj.id = te.subject_id
         LEFT JOIN teachers t ON t.id = te.teacher_id
         LEFT JOIN rooms r ON r.id = te.room_id
         WHERE ${where.join(" AND ")}
         ORDER BY te.day_of_week, p.sort_order, p.start_time`,
        params
      );
      const rows = raw.map((r) => ({ ...r, day: DAYS[Number(r.dayNum)] ?? r.dayNum }));
      return {
        title: "Timetable",
        columns: [
          { key: "day", label: "Day" },
          { key: "period", label: "Period" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "subject", label: "Subject" },
          { key: "teacher", label: "Teacher" },
          { key: "room", label: "Room" },
        ],
        rows,
      };
    },
  },

  // --- College (Phase B) reports — empty for school tenants. ---

  college_departments: {
    title: "Departments",
    category: "College",
    permission: "college:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT d.code, d.name,
                CASE WHEN t.id IS NULL THEN NULL ELSE t.first_name || ' ' || t.last_name END AS head,
                (SELECT count(*)::int FROM programs p WHERE p.department_id = d.id) AS programs
         FROM departments d LEFT JOIN teachers t ON t.id = d.head_teacher_id
         WHERE d.institution_id = $1 ORDER BY d.name`,
        [inst]
      );
      return {
        title: "Departments",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Department" },
          { key: "head", label: "Head" },
          { key: "programs", label: "Programs" },
        ],
        rows,
      };
    },
  },

  college_programs: {
    title: "Programs / Courses",
    category: "College",
    permission: "college:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.departmentId) {
        params.push(f.departmentId);
        where.push(`p.department_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT p.code, p.name, d.name AS department,
                p.duration_semesters AS duration,
                (SELECT count(*)::int FROM enrollments e WHERE e.program_id = p.id) AS students
         FROM programs p JOIN departments d ON d.id = p.department_id
         WHERE ${where.join(" AND ")} ORDER BY d.name, p.name`,
        params
      );
      return {
        title: "Programs / Courses",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Program" },
          { key: "department", label: "Department" },
          { key: "duration", label: "Semesters" },
          { key: "students", label: "Students" },
        ],
        rows,
      };
    },
  },

  college_semester_students: {
    title: "Semester Students",
    category: "College",
    permission: "college:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["e.institution_id = $1"];
      if (f.semesterId) {
        params.push(f.semesterId);
        where.push(`e.semester_id = $${params.length}`);
      }
      if (f.programId) {
        params.push(f.programId);
        where.push(`e.program_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS name,
                pr.name AS program, sem.name AS semester, e.status
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN programs pr ON pr.id = e.program_id
         LEFT JOIN semesters sem ON sem.id = e.semester_id
         WHERE ${where.join(" AND ")} ORDER BY name`,
        params
      );
      return {
        title: "Semester Students",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "name", label: "Name" },
          { key: "program", label: "Program" },
          { key: "semester", label: "Semester" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  college_semester_attendance: {
    title: "Semester Attendance",
    category: "College",
    permission: "college:read",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "admissionNo", label: "Admission No" },
        { key: "name", label: "Name" },
        { key: "present", label: "Present" },
        { key: "absent", label: "Absent" },
        { key: "late", label: "Late" },
        { key: "total", label: "Total" },
        { key: "rate", label: "Rate" },
      ];
      if (!f.semesterId) return { title: "Semester Attendance", columns, rows: [] };
      const params: unknown[] = [inst, f.semesterId];
      const joinConds = ["ar.student_id = s.id", "ar.institution_id = $1"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        joinConds.push(`ar.date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        joinConds.push(`ar.date <= $${params.length}`);
      }
      const raw = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS name,
                count(ar.id) FILTER (WHERE ar.status = 'present')::int AS present,
                count(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent,
                count(ar.id) FILTER (WHERE ar.status = 'late')::int AS late,
                count(ar.id)::int AS total
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         LEFT JOIN attendance_records ar ON ${joinConds.join(" AND ")}
         WHERE e.institution_id = $1 AND e.semester_id = $2
         GROUP BY s.id, s.admission_no, s.first_name, s.last_name
         ORDER BY name`,
        params
      );
      const rows = raw.map((r) => {
        const total = Number(r.total);
        const attended = Number(r.present) + Number(r.late);
        return { ...r, rate: total > 0 ? `${Math.round((attended / total) * 100)}%` : "—" };
      });
      return { title: "Semester Attendance", columns, rows };
    },
  },

  college_semester_results: {
    title: "Semester Results",
    category: "College",
    permission: "college:read",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "admissionNo", label: "Admission No" },
        { key: "name", label: "Name" },
        { key: "subject", label: "Subject" },
        { key: "marks", label: "Marks" },
        { key: "max", label: "Max" },
        { key: "grade", label: "Grade" },
      ];
      if (!f.semesterId) return { title: "Semester Results", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS name,
                sub.name AS subject, er.marks_obtained AS marks, er.max_marks AS max, er.grade
         FROM exam_results er
         JOIN exams ex ON ex.id = er.exam_id
         JOIN students s ON s.id = er.student_id
         JOIN subjects sub ON sub.id = er.subject_id
         WHERE er.institution_id = $1 AND ex.semester_id = $2
         ORDER BY name, subject`,
        [inst, f.semesterId]
      );
      return { title: "Semester Results", columns, rows };
    },
  },

  college_fee_dues: {
    title: "Program Fee Dues",
    category: "College",
    permission: "college:read",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = [
        "i.institution_id = $1",
        "i.status IN ('pending', 'partially_paid')",
      ];
      if (f.programId) {
        params.push(f.programId);
        where.push(`e.program_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT i.invoice_no AS "invoiceNo", s.first_name || ' ' || s.last_name AS student,
                pr.name AS program,
                i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
                (i.amount_due - i.amount_paid) AS outstanding, i.status
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         JOIN enrollments e ON e.student_id = s.id AND e.institution_id = i.institution_id
         JOIN programs pr ON pr.id = e.program_id
         WHERE ${where.join(" AND ")}
         ORDER BY i.due_date NULLS LAST`,
        params
      );
      return {
        title: "Program Fee Dues",
        columns: [
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "program", label: "Program" },
          { key: "amountDue", label: "Amount Due" },
          { key: "amountPaid", label: "Amount Paid" },
          { key: "outstanding", label: "Outstanding" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },
};

export function listReports() {
  return Object.entries(REPORTS).map(([key, r]) => ({
    key,
    title: r.title,
    category: r.category,
    permission: r.permission,
  }));
}

export function getReport(key: string): Report {
  const report = REPORTS[key];
  if (!report) throw ApiError.notFound("Unknown report");
  return report;
}

export function toCsv(columns: Col[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => esc(row[c.key])).join(","));
  }
  return lines.join("\n");
}
