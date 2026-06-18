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
  memberId?: string;
  routeId?: string;
  stopId?: string;
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

  // --- Library (Phase D) reports — empty for institutions without a library. ---

  library_stock: {
    title: "Book Stock",
    category: "Library",
    permission: "library:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["b.institution_id = $1"];
      if (f.category) {
        params.push(f.category);
        where.push(`c.name = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT b.title, b.author, b.isbn, c.name AS category, b.rack_location AS "rack",
                count(cp.id)::int AS total,
                count(cp.id) FILTER (WHERE cp.status = 'available')::int AS available,
                count(cp.id) FILTER (WHERE cp.status = 'issued')::int AS issued
         FROM books b
         LEFT JOIN book_categories c ON c.id = b.category_id
         LEFT JOIN book_copies cp ON cp.book_id = b.id
         WHERE ${where.join(" AND ")}
         GROUP BY b.id, c.name ORDER BY b.title`,
        params
      );
      return {
        title: "Book Stock",
        columns: [
          { key: "title", label: "Title" },
          { key: "author", label: "Author" },
          { key: "isbn", label: "ISBN" },
          { key: "category", label: "Category" },
          { key: "rack", label: "Rack" },
          { key: "total", label: "Total" },
          { key: "available", label: "Available" },
          { key: "issued", label: "Issued" },
        ],
        rows,
      };
    },
  },

  library_issued: {
    title: "Issued Books",
    category: "Library",
    permission: "library:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT b.title, cp.accession_number AS "accessionNo",
                COALESCE(s.first_name || ' ' || s.last_name, t.first_name || ' ' || t.last_name) AS member,
                bi.member_id, bi.issue_date AS "issueDate", bi.due_date AS "dueDate"
         FROM book_issues bi
         JOIN books b ON b.id = bi.book_id
         JOIN book_copies cp ON cp.id = bi.copy_id
         JOIN library_members m ON m.id = bi.member_id
         LEFT JOIN students s ON s.id = m.student_id
         LEFT JOIN teachers t ON t.id = m.teacher_id
         WHERE bi.institution_id = $1 AND bi.status = 'issued'
         ORDER BY bi.due_date`,
        [inst]
      );
      return {
        title: "Issued Books",
        columns: [
          { key: "title", label: "Title" },
          { key: "accessionNo", label: "Accession" },
          { key: "member", label: "Member" },
          { key: "issueDate", label: "Issued" },
          { key: "dueDate", label: "Due" },
        ],
        rows,
      };
    },
  },

  library_overdue: {
    title: "Overdue Books",
    category: "Library",
    permission: "library:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT b.title, cp.accession_number AS "accessionNo",
                COALESCE(s.first_name || ' ' || s.last_name, t.first_name || ' ' || t.last_name) AS member,
                bi.due_date AS "dueDate",
                (CURRENT_DATE - bi.due_date) AS "daysOverdue"
         FROM book_issues bi
         JOIN books b ON b.id = bi.book_id
         JOIN book_copies cp ON cp.id = bi.copy_id
         JOIN library_members m ON m.id = bi.member_id
         LEFT JOIN students s ON s.id = m.student_id
         LEFT JOIN teachers t ON t.id = m.teacher_id
         WHERE bi.institution_id = $1 AND bi.status = 'issued' AND bi.due_date < CURRENT_DATE
         ORDER BY bi.due_date`,
        [inst]
      );
      return {
        title: "Overdue Books",
        columns: [
          { key: "title", label: "Title" },
          { key: "accessionNo", label: "Accession" },
          { key: "member", label: "Member" },
          { key: "dueDate", label: "Due" },
          { key: "daysOverdue", label: "Days Overdue" },
        ],
        rows,
      };
    },
  },

  library_member_history: {
    title: "Member Borrowing History",
    category: "Library",
    permission: "library:reports",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "title", label: "Title" },
        { key: "accessionNo", label: "Accession" },
        { key: "issueDate", label: "Issued" },
        { key: "dueDate", label: "Due" },
        { key: "returnDate", label: "Returned" },
        { key: "status", label: "Status" },
        { key: "fineAmount", label: "Fine" },
      ];
      if (!f.memberId) return { title: "Member Borrowing History", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT b.title, cp.accession_number AS "accessionNo",
                bi.issue_date AS "issueDate", bi.due_date AS "dueDate",
                bi.return_date AS "returnDate", bi.status, bi.fine_amount AS "fineAmount"
         FROM book_issues bi
         JOIN books b ON b.id = bi.book_id
         JOIN book_copies cp ON cp.id = bi.copy_id
         WHERE bi.institution_id = $1 AND bi.member_id = $2
         ORDER BY bi.issue_date DESC`,
        [inst, f.memberId]
      );
      return { title: "Member Borrowing History", columns, rows };
    },
  },

  library_lost_damaged: {
    title: "Lost / Damaged Books",
    category: "Library",
    permission: "library:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT b.title, cp.accession_number AS "accessionNo", cp.status
         FROM book_copies cp JOIN books b ON b.id = cp.book_id
         WHERE cp.institution_id = $1 AND cp.status IN ('lost', 'damaged')
         ORDER BY cp.status, b.title`,
        [inst]
      );
      return {
        title: "Lost / Damaged Books",
        columns: [
          { key: "title", label: "Title" },
          { key: "accessionNo", label: "Accession" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  library_fines: {
    title: "Library Fines",
    category: "Library",
    permission: "library:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT b.title,
                COALESCE(s.first_name || ' ' || s.last_name, t.first_name || ' ' || t.last_name) AS member,
                bi.fine_amount AS "fineAmount", bi.fine_status AS "fineStatus",
                bi.return_date AS "returnDate"
         FROM book_issues bi
         JOIN books b ON b.id = bi.book_id
         JOIN library_members m ON m.id = bi.member_id
         LEFT JOIN students s ON s.id = m.student_id
         LEFT JOIN teachers t ON t.id = m.teacher_id
         WHERE bi.institution_id = $1 AND bi.fine_amount > 0
         ORDER BY bi.return_date DESC NULLS LAST`,
        [inst]
      );
      return {
        title: "Library Fines",
        columns: [
          { key: "title", label: "Title" },
          { key: "member", label: "Member" },
          { key: "fineAmount", label: "Fine" },
          { key: "fineStatus", label: "Status" },
          { key: "returnDate", label: "Returned" },
        ],
        rows,
      };
    },
  },

  // --- Transport (Phase D) reports — empty without transport set up. ---

  transport_route_students: {
    title: "Route-wise Students",
    category: "Transport",
    permission: "transport:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["st.institution_id = $1"];
      if (f.routeId) {
        params.push(f.routeId);
        where.push(`st.route_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT r.name AS route, s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                rs.name AS stop, st.trip_type AS "tripType", st.status
         FROM student_transport st
         JOIN students s ON s.id = st.student_id
         JOIN transport_routes r ON r.id = st.route_id
         LEFT JOIN route_stops rs ON rs.id = st.stop_id
         WHERE ${where.join(" AND ")}
         ORDER BY r.name, student`,
        params
      );
      return {
        title: "Route-wise Students",
        columns: [
          { key: "route", label: "Route" },
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "stop", label: "Stop" },
          { key: "tripType", label: "Trip" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  transport_stop_students: {
    title: "Stop-wise Students",
    category: "Transport",
    permission: "transport:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["st.institution_id = $1"];
      if (f.stopId) {
        params.push(f.stopId);
        where.push(`st.stop_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT rs.name AS stop, r.name AS route, s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student, st.trip_type AS "tripType"
         FROM student_transport st
         JOIN students s ON s.id = st.student_id
         JOIN transport_routes r ON r.id = st.route_id
         LEFT JOIN route_stops rs ON rs.id = st.stop_id
         WHERE ${where.join(" AND ")}
         ORDER BY rs.name NULLS LAST, student`,
        params
      );
      return {
        title: "Stop-wise Students",
        columns: [
          { key: "stop", label: "Stop" },
          { key: "route", label: "Route" },
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "tripType", label: "Trip" },
        ],
        rows,
      };
    },
  },

  transport_vehicles: {
    title: "Vehicles",
    category: "Transport",
    permission: "transport:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT registration_no AS "registrationNo", type, capacity,
                insurance_expiry AS "insuranceExpiry", fitness_expiry AS "fitnessExpiry",
                permit_expiry AS "permitExpiry", is_active AS active
         FROM vehicles WHERE institution_id = $1 ORDER BY registration_no`,
        [inst]
      );
      return {
        title: "Vehicles",
        columns: [
          { key: "registrationNo", label: "Registration" },
          { key: "type", label: "Type" },
          { key: "capacity", label: "Capacity" },
          { key: "insuranceExpiry", label: "Insurance" },
          { key: "fitnessExpiry", label: "Fitness" },
          { key: "permitExpiry", label: "Permit" },
          { key: "active", label: "Active" },
        ],
        rows,
      };
    },
  },

  transport_drivers: {
    title: "Drivers",
    category: "Transport",
    permission: "transport:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT name, phone, license_number AS "licenseNumber",
                license_expiry AS "licenseExpiry", helper_name AS "helperName",
                is_active AS active
         FROM drivers WHERE institution_id = $1 ORDER BY name`,
        [inst]
      );
      return {
        title: "Drivers",
        columns: [
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone" },
          { key: "licenseNumber", label: "License" },
          { key: "licenseExpiry", label: "License Expiry" },
          { key: "helperName", label: "Helper" },
          { key: "active", label: "Active" },
        ],
        rows,
      };
    },
  },

  transport_fee_dues: {
    title: "Transport Fee Dues",
    category: "Transport",
    permission: "transport:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT i.invoice_no AS "invoiceNo", s.first_name || ' ' || s.last_name AS student,
                r.name AS route, ti.period,
                i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
                (i.amount_due - i.amount_paid) AS outstanding, i.status
         FROM transport_invoices ti
         JOIN invoices i ON i.id = ti.invoice_id
         JOIN students s ON s.id = ti.student_id
         LEFT JOIN transport_routes r ON r.id = ti.route_id
         WHERE ti.institution_id = $1 AND i.status IN ('pending', 'partially_paid')
         ORDER BY i.due_date NULLS LAST`,
        [inst]
      );
      return {
        title: "Transport Fee Dues",
        columns: [
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "route", label: "Route" },
          { key: "period", label: "Period" },
          { key: "amountDue", label: "Amount Due" },
          { key: "amountPaid", label: "Amount Paid" },
          { key: "outstanding", label: "Outstanding" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  transport_occupancy: {
    title: "Route Occupancy",
    category: "Transport",
    permission: "transport:reports",
    run: async (_f, inst) => {
      const raw = await rowsOf(
        `SELECT r.name AS route, v.registration_no AS "vehicleNo", v.capacity,
                count(st.id) FILTER (WHERE st.status = 'active')::int AS allocated
         FROM transport_routes r
         LEFT JOIN vehicles v ON v.id = r.vehicle_id
         LEFT JOIN student_transport st ON st.route_id = r.id
         WHERE r.institution_id = $1
         GROUP BY r.id, v.registration_no, v.capacity
         ORDER BY r.name`,
        [inst]
      );
      const rows = raw.map((r) => {
        const cap = r.capacity == null ? null : Number(r.capacity);
        const allocated = Number(r.allocated);
        return {
          ...r,
          free: cap == null ? "—" : cap - allocated,
          utilization: cap && cap > 0 ? `${Math.round((allocated / cap) * 100)}%` : "—",
        };
      });
      return {
        title: "Route Occupancy",
        columns: [
          { key: "route", label: "Route" },
          { key: "vehicleNo", label: "Vehicle" },
          { key: "capacity", label: "Capacity" },
          { key: "allocated", label: "Allocated" },
          { key: "free", label: "Free" },
          { key: "utilization", label: "Utilization" },
        ],
        rows,
      };
    },
  },

  transport_expiry: {
    title: "Document Expiry",
    category: "Transport",
    permission: "transport:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT * FROM (
           SELECT 'Vehicle' AS entity, registration_no AS identifier, 'Insurance' AS document,
                  insurance_expiry AS "expiryDate", (insurance_expiry - CURRENT_DATE) AS "daysToExpiry"
           FROM vehicles WHERE institution_id = $1 AND insurance_expiry IS NOT NULL
           UNION ALL
           SELECT 'Vehicle', registration_no, 'Fitness', fitness_expiry, (fitness_expiry - CURRENT_DATE)
           FROM vehicles WHERE institution_id = $1 AND fitness_expiry IS NOT NULL
           UNION ALL
           SELECT 'Vehicle', registration_no, 'Permit', permit_expiry, (permit_expiry - CURRENT_DATE)
           FROM vehicles WHERE institution_id = $1 AND permit_expiry IS NOT NULL
           UNION ALL
           SELECT 'Driver', name, 'License', license_expiry, (license_expiry - CURRENT_DATE)
           FROM drivers WHERE institution_id = $1 AND license_expiry IS NOT NULL
         ) e ORDER BY e."daysToExpiry"`,
        [inst]
      );
      const out = rows.map((r) => ({
        ...r,
        status: Number(r.daysToExpiry) < 0 ? "Expired" : Number(r.daysToExpiry) <= 30 ? "Expiring soon" : "Valid",
      }));
      return {
        title: "Document Expiry",
        columns: [
          { key: "entity", label: "Entity" },
          { key: "identifier", label: "Identifier" },
          { key: "document", label: "Document" },
          { key: "expiryDate", label: "Expiry" },
          { key: "daysToExpiry", label: "Days Left" },
          { key: "status", label: "Status" },
        ],
        rows: out,
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
