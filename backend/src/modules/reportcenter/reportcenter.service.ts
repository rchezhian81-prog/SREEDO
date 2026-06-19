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
  hostelId?: string;
  roomId?: string;
  itemId?: string;
  vendorId?: string;
  teacherId?: string;
  month?: string;
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

  // --- Hostel (Phase D) reports — empty without hostels set up. ---

  hostel_students: {
    title: "Hostel-wise Students",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["a.institution_id = $1", "a.status = 'active'"];
      if (f.hostelId) {
        params.push(f.hostelId);
        where.push(`a.hostel_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT h.name AS hostel, s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                r.room_number AS room, a.bed_no AS bed
         FROM hostel_allocations a
         JOIN students s ON s.id = a.student_id
         JOIN hostels h ON h.id = a.hostel_id
         JOIN hostel_rooms r ON r.id = a.room_id
         WHERE ${where.join(" AND ")}
         ORDER BY h.name, r.room_number, student`,
        params
      );
      return {
        title: "Hostel-wise Students",
        columns: [
          { key: "hostel", label: "Hostel" },
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "room", label: "Room" },
          { key: "bed", label: "Bed" },
        ],
        rows,
      };
    },
  },

  hostel_room_allocation: {
    title: "Room-wise Allocation",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["r.institution_id = $1"];
      if (f.hostelId) {
        params.push(f.hostelId);
        where.push(`r.hostel_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT h.name AS hostel, r.room_number AS room, r.room_type AS "roomType",
                r.capacity,
                count(a.id) FILTER (WHERE a.status = 'active')::int AS occupied,
                (r.capacity - count(a.id) FILTER (WHERE a.status = 'active'))::int AS available,
                r.status
         FROM hostel_rooms r
         JOIN hostels h ON h.id = r.hostel_id
         LEFT JOIN hostel_allocations a ON a.room_id = r.id
         WHERE ${where.join(" AND ")}
         GROUP BY r.id, h.name
         ORDER BY h.name, r.room_number`,
        params
      );
      return {
        title: "Room-wise Allocation",
        columns: [
          { key: "hostel", label: "Hostel" },
          { key: "room", label: "Room" },
          { key: "roomType", label: "Type" },
          { key: "capacity", label: "Capacity" },
          { key: "occupied", label: "Occupied" },
          { key: "available", label: "Available" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  hostel_occupancy: {
    title: "Hostel Occupancy",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (_f, inst) => {
      const raw = await rowsOf(
        `SELECT h.name AS hostel, h.type,
                COALESCE(sum(r.capacity), 0)::int AS beds,
                (SELECT count(*)::int FROM hostel_allocations a
                   WHERE a.hostel_id = h.id AND a.status = 'active') AS occupied
         FROM hostels h
         LEFT JOIN hostel_rooms r ON r.hostel_id = h.id
         WHERE h.institution_id = $1
         GROUP BY h.id
         ORDER BY h.name`,
        [inst]
      );
      const rows = raw.map((r) => {
        const beds = Number(r.beds);
        const occupied = Number(r.occupied);
        return {
          ...r,
          vacant: beds - occupied,
          utilization: beds > 0 ? `${Math.round((occupied / beds) * 100)}%` : "—",
        };
      });
      return {
        title: "Hostel Occupancy",
        columns: [
          { key: "hostel", label: "Hostel" },
          { key: "type", label: "Type" },
          { key: "beds", label: "Beds" },
          { key: "occupied", label: "Occupied" },
          { key: "vacant", label: "Vacant" },
          { key: "utilization", label: "Utilization" },
        ],
        rows,
      };
    },
  },

  hostel_fee_dues: {
    title: "Hostel Fee Dues",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT i.invoice_no AS "invoiceNo", s.first_name || ' ' || s.last_name AS student,
                h.name AS hostel, hi.period,
                i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
                (i.amount_due - i.amount_paid) AS outstanding, i.status
         FROM hostel_invoices hi
         JOIN invoices i ON i.id = hi.invoice_id
         JOIN students s ON s.id = hi.student_id
         LEFT JOIN hostels h ON h.id = hi.hostel_id
         WHERE hi.institution_id = $1 AND i.status IN ('pending', 'partially_paid')
         ORDER BY i.due_date NULLS LAST`,
        [inst]
      );
      return {
        title: "Hostel Fee Dues",
        columns: [
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "hostel", label: "Hostel" },
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

  hostel_vacated: {
    title: "Vacated Students",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo", s.first_name || ' ' || s.last_name AS student,
                h.name AS hostel, r.room_number AS room,
                a.allocation_date AS "allocationDate", a.vacate_date AS "vacateDate", a.status
         FROM hostel_allocations a
         JOIN students s ON s.id = a.student_id
         JOIN hostels h ON h.id = a.hostel_id
         JOIN hostel_rooms r ON r.id = a.room_id
         WHERE a.institution_id = $1 AND a.status IN ('vacated', 'transferred')
         ORDER BY a.vacate_date DESC NULLS LAST`,
        [inst]
      );
      return {
        title: "Vacated Students",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "hostel", label: "Hostel" },
          { key: "room", label: "Room" },
          { key: "allocationDate", label: "Allocated" },
          { key: "vacateDate", label: "Vacated" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  hostel_maintenance: {
    title: "Maintenance Rooms",
    category: "Hostel",
    permission: "hostel:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT h.name AS hostel, r.room_number AS room, r.room_type AS "roomType", r.status
         FROM hostel_rooms r JOIN hostels h ON h.id = r.hostel_id
         WHERE r.institution_id = $1 AND r.status IN ('maintenance', 'inactive')
         ORDER BY h.name, r.room_number`,
        [inst]
      );
      return {
        title: "Maintenance Rooms",
        columns: [
          { key: "hostel", label: "Hostel" },
          { key: "room", label: "Room" },
          { key: "roomType", label: "Type" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  // --- Inventory (Phase D) reports — empty without inventory set up. ---

  inventory_stock_register: {
    title: "Stock Register",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["i.institution_id = $1"];
      if (f.category) {
        params.push(f.category);
        where.push(`c.name = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT i.code, i.name, c.name AS category, i.unit,
                i.opening_stock AS "opening", i.current_stock AS "current",
                i.min_stock_level AS "minLevel", i.location
         FROM inventory_items i LEFT JOIN item_categories c ON c.id = i.category_id
         WHERE ${where.join(" AND ")} ORDER BY i.name`,
        params
      );
      return {
        title: "Stock Register",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Item" },
          { key: "category", label: "Category" },
          { key: "unit", label: "Unit" },
          { key: "opening", label: "Opening" },
          { key: "current", label: "Current" },
          { key: "minLevel", label: "Min" },
          { key: "location", label: "Location" },
        ],
        rows,
      };
    },
  },

  inventory_low_stock: {
    title: "Low Stock",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT i.code, i.name, i.unit, i.current_stock AS "current", i.min_stock_level AS "minLevel"
         FROM inventory_items i
         WHERE i.institution_id = $1 AND i.current_stock <= i.min_stock_level
         ORDER BY i.name`,
        [inst]
      );
      return {
        title: "Low Stock",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Item" },
          { key: "unit", label: "Unit" },
          { key: "current", label: "Current" },
          { key: "minLevel", label: "Min" },
        ],
        rows,
      };
    },
  },

  inventory_purchases: {
    title: "Purchases",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.vendorId) {
        params.push(f.vendorId);
        where.push(`p.vendor_id = $${params.length}`);
      }
      if (f.dateFrom) {
        params.push(f.dateFrom);
        where.push(`p.purchase_date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        where.push(`p.purchase_date <= $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT p.purchase_date AS date, v.name AS vendor, p.bill_no AS "billNo",
                it.name AS item, pi.quantity, pi.rate, pi.amount
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         JOIN inventory_items it ON it.id = pi.item_id
         LEFT JOIN vendors v ON v.id = p.vendor_id
         WHERE ${where.join(" AND ")}
         ORDER BY p.purchase_date DESC`,
        params
      );
      return {
        title: "Purchases",
        columns: [
          { key: "date", label: "Date" },
          { key: "vendor", label: "Vendor" },
          { key: "billNo", label: "Bill No" },
          { key: "item", label: "Item" },
          { key: "quantity", label: "Qty" },
          { key: "rate", label: "Rate" },
          { key: "amount", label: "Amount" },
        ],
        rows,
      };
    },
  },

  inventory_issues: {
    title: "Stock Issues",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["si.institution_id = $1"];
      if (f.itemId) {
        params.push(f.itemId);
        where.push(`si.item_id = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT si.issue_date AS date, it.name AS item, si.quantity,
                si.issued_to_type AS "issuedToType", si.issued_to AS "issuedTo", si.purpose
         FROM stock_issues si JOIN inventory_items it ON it.id = si.item_id
         WHERE ${where.join(" AND ")} ORDER BY si.issue_date DESC`,
        params
      );
      return {
        title: "Stock Issues",
        columns: [
          { key: "date", label: "Date" },
          { key: "item", label: "Item" },
          { key: "quantity", label: "Qty" },
          { key: "issuedToType", label: "Issued To" },
          { key: "issuedTo", label: "Recipient" },
          { key: "purpose", label: "Purpose" },
        ],
        rows,
      };
    },
  },

  inventory_vendor_purchases: {
    title: "Vendor-wise Purchases",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT v.name AS vendor,
                count(p.id)::int AS purchases,
                COALESCE(sum(p.total_amount), 0) AS "totalAmount"
         FROM vendors v LEFT JOIN purchases p ON p.vendor_id = v.id
         WHERE v.institution_id = $1
         GROUP BY v.id ORDER BY "totalAmount" DESC`,
        [inst]
      );
      return {
        title: "Vendor-wise Purchases",
        columns: [
          { key: "vendor", label: "Vendor" },
          { key: "purchases", label: "Purchases" },
          { key: "totalAmount", label: "Total Amount" },
        ],
        rows,
      };
    },
  },

  inventory_item_movements: {
    title: "Item Movement History",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "date", label: "Date" },
        { key: "item", label: "Item" },
        { key: "type", label: "Type" },
        { key: "change", label: "Change" },
        { key: "balanceAfter", label: "Balance" },
        { key: "note", label: "Note" },
      ];
      if (!f.itemId) return { title: "Item Movement History", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT m.created_at::date AS date, it.name AS item, m.type, m.change,
                m.balance_after AS "balanceAfter", m.note
         FROM stock_movements m JOIN inventory_items it ON it.id = m.item_id
         WHERE m.institution_id = $1 AND m.item_id = $2
         ORDER BY m.created_at, m.id`,
        [inst, f.itemId]
      );
      return { title: "Item Movement History", columns, rows };
    },
  },

  inventory_damaged_lost: {
    title: "Damaged / Lost Stock",
    category: "Inventory",
    permission: "inventory:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT sa.created_at::date AS date, it.name AS item, sa.quantity, sa.reason,
                sa.note, sa.approved_by AS "approvedBy"
         FROM stock_adjustments sa JOIN inventory_items it ON it.id = sa.item_id
         WHERE sa.institution_id = $1 AND sa.reason IN ('damage', 'lost')
         ORDER BY sa.created_at DESC`,
        [inst]
      );
      return {
        title: "Damaged / Lost Stock",
        columns: [
          { key: "date", label: "Date" },
          { key: "item", label: "Item" },
          { key: "quantity", label: "Qty" },
          { key: "reason", label: "Reason" },
          { key: "note", label: "Note" },
          { key: "approvedBy", label: "Approved By" },
        ],
        rows,
      };
    },
  },

  // --- Staff attendance & leave (Phase D) reports. ---

  staff_attendance_daily: {
    title: "Daily Staff Attendance",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "employeeNo", label: "Employee No" },
        { key: "name", label: "Staff" },
        { key: "status", label: "Status" },
        { key: "checkIn", label: "In" },
        { key: "checkOut", label: "Out" },
        { key: "late", label: "Late" },
      ];
      if (!f.dateFrom) return { title: "Daily Staff Attendance", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                sa.status, sa.check_in AS "checkIn", sa.check_out AS "checkOut", sa.late
         FROM staff_attendance sa JOIN teachers t ON t.id = sa.teacher_id
         WHERE sa.institution_id = $1 AND sa.date = $2 ORDER BY name`,
        [inst, f.dateFrom]
      );
      return { title: "Daily Staff Attendance", columns, rows };
    },
  },

  staff_attendance_monthly: {
    title: "Monthly Staff Attendance",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "employeeNo", label: "Employee No" },
        { key: "name", label: "Staff" },
        { key: "present", label: "Present" },
        { key: "absent", label: "Absent" },
        { key: "halfDay", label: "Half-day" },
        { key: "leave", label: "Leave" },
        { key: "holiday", label: "Holiday" },
        { key: "lateCount", label: "Late" },
      ];
      if (!f.month) return { title: "Monthly Staff Attendance", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                count(sa.id) FILTER (WHERE sa.status='present')::int AS present,
                count(sa.id) FILTER (WHERE sa.status='absent')::int AS absent,
                count(sa.id) FILTER (WHERE sa.status='half_day')::int AS "halfDay",
                count(sa.id) FILTER (WHERE sa.status='leave')::int AS leave,
                count(sa.id) FILTER (WHERE sa.status='holiday')::int AS holiday,
                count(sa.id) FILTER (WHERE sa.late)::int AS "lateCount"
         FROM teachers t
         LEFT JOIN staff_attendance sa ON sa.teacher_id = t.id AND sa.institution_id = $1
           AND sa.date >= $2::date AND sa.date < ($2::date + interval '1 month')
         WHERE t.institution_id = $1 GROUP BY t.id ORDER BY name`,
        [inst, `${f.month}-01`]
      );
      return { title: "Monthly Staff Attendance", columns, rows };
    },
  },

  staff_attendance_summary: {
    title: "Staff Attendance Summary",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const joinConds = ["sa.teacher_id = t.id", "sa.institution_id = $1"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        joinConds.push(`sa.date >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        joinConds.push(`sa.date <= $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                count(sa.id) FILTER (WHERE sa.status='present')::int AS present,
                count(sa.id) FILTER (WHERE sa.status='absent')::int AS absent,
                count(sa.id) FILTER (WHERE sa.status='half_day')::int AS "halfDay",
                count(sa.id) FILTER (WHERE sa.status='leave')::int AS leave,
                count(sa.id)::int AS total
         FROM teachers t
         LEFT JOIN staff_attendance sa ON ${joinConds.join(" AND ")}
         WHERE t.institution_id = $1 GROUP BY t.id ORDER BY name`,
        params
      );
      return {
        title: "Staff Attendance Summary",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "present", label: "Present" },
          { key: "absent", label: "Absent" },
          { key: "halfDay", label: "Half-day" },
          { key: "leave", label: "Leave" },
          { key: "total", label: "Total Marked" },
        ],
        rows,
      };
    },
  },

  leave_register: {
    title: "Leave Register",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["r.institution_id = $1"];
      if (f.status) {
        params.push(f.status);
        where.push(`r.status = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                lt.name AS "leaveType", r.start_date AS "startDate", r.end_date AS "endDate",
                r.days, r.status
         FROM leave_requests r
         JOIN teachers t ON t.id = r.teacher_id
         LEFT JOIN leave_types lt ON lt.id = r.leave_type_id
         WHERE ${where.join(" AND ")} ORDER BY r.start_date DESC`,
        params
      );
      return {
        title: "Leave Register",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "leaveType", label: "Leave Type" },
          { key: "startDate", label: "From" },
          { key: "endDate", label: "To" },
          { key: "days", label: "Days" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  leave_balance: {
    title: "Leave Balance",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                lt.name AS "leaveType", lt.is_paid AS "isPaid", b.balance
         FROM leave_balances b
         JOIN teachers t ON t.id = b.teacher_id
         JOIN leave_types lt ON lt.id = b.leave_type_id
         WHERE b.institution_id = $1 ORDER BY name, lt.name`,
        [inst]
      );
      return {
        title: "Leave Balance",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "leaveType", label: "Leave Type" },
          { key: "isPaid", label: "Paid" },
          { key: "balance", label: "Balance" },
        ],
        rows,
      };
    },
  },

  leave_pending: {
    title: "Pending Leave Approvals",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                lt.name AS "leaveType", r.start_date AS "startDate", r.end_date AS "endDate",
                r.days, r.reason
         FROM leave_requests r
         JOIN teachers t ON t.id = r.teacher_id
         LEFT JOIN leave_types lt ON lt.id = r.leave_type_id
         WHERE r.institution_id = $1 AND r.status = 'pending' ORDER BY r.created_at`,
        [inst]
      );
      return {
        title: "Pending Leave Approvals",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "leaveType", label: "Leave Type" },
          { key: "startDate", label: "From" },
          { key: "endDate", label: "To" },
          { key: "days", label: "Days" },
          { key: "reason", label: "Reason" },
        ],
        rows,
      };
    },
  },

  payroll_attendance_summary: {
    title: "Payroll Attendance Summary",
    category: "Staff Attendance",
    permission: "leave:reports",
    run: async (f, inst) => {
      const columns: Col[] = [
        { key: "employeeNo", label: "Employee No" },
        { key: "name", label: "Staff" },
        { key: "workingDays", label: "Working" },
        { key: "presentDays", label: "Present" },
        { key: "absentDays", label: "Absent" },
        { key: "halfDays", label: "Half-day" },
        { key: "paidLeave", label: "Paid Leave" },
        { key: "unpaidLeave", label: "Unpaid Leave" },
        { key: "lateCount", label: "Late" },
      ];
      if (!f.month) return { title: "Payroll Attendance Summary", columns, rows: [] };
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                count(sa.id) FILTER (WHERE sa.status IN ('present','absent','half_day','leave'))::int AS "workingDays",
                count(sa.id) FILTER (WHERE sa.status='present')::int AS "presentDays",
                count(sa.id) FILTER (WHERE sa.status='absent')::int AS "absentDays",
                count(sa.id) FILTER (WHERE sa.status='half_day')::int AS "halfDays",
                count(sa.id) FILTER (WHERE sa.status='leave' AND lt.is_paid)::int AS "paidLeave",
                count(sa.id) FILTER (WHERE sa.status='leave' AND (lt.is_paid IS NULL OR lt.is_paid=false))::int AS "unpaidLeave",
                count(sa.id) FILTER (WHERE sa.late)::int AS "lateCount"
         FROM teachers t
         LEFT JOIN staff_attendance sa ON sa.teacher_id = t.id AND sa.institution_id = $1
           AND sa.date >= $2::date AND sa.date < ($2::date + interval '1 month')
         LEFT JOIN leave_types lt ON lt.id = sa.leave_type_id
         WHERE t.institution_id = $1 GROUP BY t.id ORDER BY name`,
        [inst, `${f.month}-01`]
      );
      return { title: "Payroll Attendance Summary", columns, rows };
    },
  },

  // --- Payroll (Phase D) reports. ---

  payroll_register: {
    title: "Monthly Payroll Register",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.month) {
        params.push(`${f.month}-01`);
        where.push(`p.month = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT to_char(p.month, 'YYYY-MM') AS month, t.employee_no AS "employeeNo",
                t.first_name || ' ' || t.last_name AS name,
                p.gross, p.deductions, p.net, p.status
         FROM payslips p JOIN teachers t ON t.id = p.teacher_id
         WHERE ${where.join(" AND ")} ORDER BY p.month DESC, name`,
        params
      );
      return {
        title: "Monthly Payroll Register",
        columns: [
          { key: "month", label: "Month" },
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "gross", label: "Gross" },
          { key: "deductions", label: "Deductions" },
          { key: "net", label: "Net" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  payroll_salary: {
    title: "Staff-wise Salary",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT t.employee_no AS "employeeNo", t.first_name || ' ' || t.last_name AS name,
                s.effective_date AS "effectiveDate",
                COALESCE(sum(ssc.value) FILTER (WHERE c.type='earning' AND ssc.calc_type='fixed'), 0) AS "fixedEarnings",
                COALESCE(sum(ssc.value) FILTER (WHERE c.type='deduction' AND ssc.calc_type='fixed'), 0) AS "fixedDeductions"
         FROM salary_structures s
         JOIN teachers t ON t.id = s.teacher_id
         LEFT JOIN salary_structure_components ssc ON ssc.structure_id = s.id
         LEFT JOIN salary_components c ON c.id = ssc.component_id
         WHERE s.institution_id = $1 AND s.is_active = true
         GROUP BY t.id, s.effective_date ORDER BY name`,
        [inst]
      );
      return {
        title: "Staff-wise Salary",
        columns: [
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "effectiveDate", label: "Effective" },
          { key: "fixedEarnings", label: "Fixed Earnings" },
          { key: "fixedDeductions", label: "Fixed Deductions" },
        ],
        rows,
      };
    },
  },

  payroll_deductions: {
    title: "Deduction Report",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["pl.institution_id = $1", "pl.type = 'deduction'"];
      if (f.month) {
        params.push(`${f.month}-01`);
        where.push(`p.month = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT to_char(p.month, 'YYYY-MM') AS month, t.employee_no AS "employeeNo",
                t.first_name || ' ' || t.last_name AS name, pl.name AS component, pl.amount
         FROM payslip_lines pl
         JOIN payslips p ON p.id = pl.payslip_id
         JOIN teachers t ON t.id = p.teacher_id
         WHERE ${where.join(" AND ")} ORDER BY p.month DESC, name, component`,
        params
      );
      return {
        title: "Deduction Report",
        columns: [
          { key: "month", label: "Month" },
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "component", label: "Deduction" },
          { key: "amount", label: "Amount" },
        ],
        rows,
      };
    },
  },

  payslip_status: {
    title: "Payslip Status",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.month) {
        params.push(`${f.month}-01`);
        where.push(`p.month = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT to_char(p.month, 'YYYY-MM') AS month, t.employee_no AS "employeeNo",
                t.first_name || ' ' || t.last_name AS name, p.net, p.status
         FROM payslips p JOIN teachers t ON t.id = p.teacher_id
         WHERE ${where.join(" AND ")} ORDER BY p.month DESC, name`,
        params
      );
      return {
        title: "Payslip Status",
        columns: [
          { key: "month", label: "Month" },
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "net", label: "Net Pay" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  attendance_vs_payroll: {
    title: "Attendance vs Payroll",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["p.institution_id = $1"];
      if (f.month) {
        params.push(`${f.month}-01`);
        where.push(`p.month = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT to_char(p.month, 'YYYY-MM') AS month, t.employee_no AS "employeeNo",
                t.first_name || ' ' || t.last_name AS name,
                p.working_days AS "workingDays", p.present_days AS "presentDays",
                p.paid_leave AS "paidLeave", p.unpaid_leave AS "unpaidLeave",
                p.gross, p.net
         FROM payslips p JOIN teachers t ON t.id = p.teacher_id
         WHERE ${where.join(" AND ")} ORDER BY p.month DESC, name`,
        params
      );
      return {
        title: "Attendance vs Payroll",
        columns: [
          { key: "month", label: "Month" },
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "workingDays", label: "Working" },
          { key: "presentDays", label: "Present" },
          { key: "paidLeave", label: "Paid Leave" },
          { key: "unpaidLeave", label: "Unpaid Leave" },
          { key: "gross", label: "Gross" },
          { key: "net", label: "Net" },
        ],
        rows,
      };
    },
  },

  unpaid_leave_deduction: {
    title: "Unpaid Leave Deductions",
    category: "Payroll",
    permission: "payroll:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["pl.institution_id = $1", "pl.type = 'deduction'", "pl.name = 'Unpaid Leave'"];
      if (f.month) {
        params.push(`${f.month}-01`);
        where.push(`p.month = $${params.length}`);
      }
      const rows = await rowsOf(
        `SELECT to_char(p.month, 'YYYY-MM') AS month, t.employee_no AS "employeeNo",
                t.first_name || ' ' || t.last_name AS name,
                p.unpaid_leave AS "unpaidLeaveDays", pl.amount AS "deduction"
         FROM payslip_lines pl
         JOIN payslips p ON p.id = pl.payslip_id
         JOIN teachers t ON t.id = p.teacher_id
         WHERE ${where.join(" AND ")} ORDER BY p.month DESC, name`,
        params
      );
      return {
        title: "Unpaid Leave Deductions",
        columns: [
          { key: "month", label: "Month" },
          { key: "employeeNo", label: "Employee No" },
          { key: "name", label: "Staff" },
          { key: "unpaidLeaveDays", label: "Unpaid Days" },
          { key: "deduction", label: "Deduction" },
        ],
        rows,
      };
    },
  },

  online_payment_transactions: {
    title: "Online Payment Transactions",
    category: "Online Payments",
    permission: "online_payments:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["po.institution_id = $1"];
      if (f.status) {
        params.push(f.status);
        where.push(`po.status = $${params.length}`);
      }
      if (f.dateFrom) {
        params.push(f.dateFrom);
        where.push(`po.created_at >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        where.push(`po.created_at <= ($${params.length}::date + 1)`);
      }
      const rows = await rowsOf(
        `SELECT po.order_no AS "orderNo", i.invoice_no AS "invoiceNo",
                s.first_name || ' ' || s.last_name AS student,
                po.amount, po.currency, po.status, po.provider,
                po.gateway_ref AS "gatewayRef", po.created_at AS "createdAt"
         FROM payment_orders po
         JOIN invoices i ON i.id = po.invoice_id
         JOIN students s ON s.id = po.student_id
         WHERE ${where.join(" AND ")} ORDER BY po.created_at DESC`,
        params
      );
      return {
        title: "Online Payment Transactions",
        columns: [
          { key: "orderNo", label: "Order No" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "amount", label: "Amount" },
          { key: "currency", label: "Currency" },
          { key: "status", label: "Status" },
          { key: "provider", label: "Provider" },
          { key: "gatewayRef", label: "Gateway Ref" },
          { key: "createdAt", label: "Created" },
        ],
        rows,
      };
    },
  },

  online_payments_successful: {
    title: "Successful Online Payments",
    category: "Online Payments",
    permission: "online_payments:reports",
    run: async (f, inst) => {
      const params: unknown[] = [inst];
      const where = ["po.institution_id = $1", "po.status = 'success'"];
      if (f.dateFrom) {
        params.push(f.dateFrom);
        where.push(`po.created_at >= $${params.length}`);
      }
      if (f.dateTo) {
        params.push(f.dateTo);
        where.push(`po.created_at <= ($${params.length}::date + 1)`);
      }
      const rows = await rowsOf(
        `SELECT po.order_no AS "orderNo", i.invoice_no AS "invoiceNo",
                s.first_name || ' ' || s.last_name AS student,
                po.amount, po.provider, po.gateway_payment_id AS "paymentRef",
                po.updated_at AS "paidAt"
         FROM payment_orders po
         JOIN invoices i ON i.id = po.invoice_id
         JOIN students s ON s.id = po.student_id
         WHERE ${where.join(" AND ")} ORDER BY po.updated_at DESC`,
        params
      );
      return {
        title: "Successful Online Payments",
        columns: [
          { key: "orderNo", label: "Order No" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "amount", label: "Amount" },
          { key: "provider", label: "Provider" },
          { key: "paymentRef", label: "Payment Ref" },
          { key: "paidAt", label: "Paid At" },
        ],
        rows,
      };
    },
  },

  online_payments_failed: {
    title: "Failed / Cancelled Online Payments",
    category: "Online Payments",
    permission: "online_payments:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT po.order_no AS "orderNo", i.invoice_no AS "invoiceNo",
                s.first_name || ' ' || s.last_name AS student,
                po.amount, po.status, po.provider, po.updated_at AS "updatedAt"
         FROM payment_orders po
         JOIN invoices i ON i.id = po.invoice_id
         JOIN students s ON s.id = po.student_id
         WHERE po.institution_id = $1 AND po.status IN ('failed', 'cancelled', 'expired')
         ORDER BY po.updated_at DESC`,
        [inst]
      );
      return {
        title: "Failed / Cancelled Online Payments",
        columns: [
          { key: "orderNo", label: "Order No" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "amount", label: "Amount" },
          { key: "status", label: "Status" },
          { key: "provider", label: "Provider" },
          { key: "updatedAt", label: "Updated" },
        ],
        rows,
      };
    },
  },

  online_payment_orders_pending: {
    title: "Pending Payment Orders",
    category: "Online Payments",
    permission: "online_payments:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT po.order_no AS "orderNo", i.invoice_no AS "invoiceNo",
                s.first_name || ' ' || s.last_name AS student,
                po.amount, po.status, po.provider, po.created_at AS "createdAt"
         FROM payment_orders po
         JOIN invoices i ON i.id = po.invoice_id
         JOIN students s ON s.id = po.student_id
         WHERE po.institution_id = $1 AND po.status IN ('created', 'pending')
         ORDER BY po.created_at DESC`,
        [inst]
      );
      return {
        title: "Pending Payment Orders",
        columns: [
          { key: "orderNo", label: "Order No" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "student", label: "Student" },
          { key: "amount", label: "Amount" },
          { key: "status", label: "Status" },
          { key: "provider", label: "Provider" },
          { key: "createdAt", label: "Created" },
        ],
        rows,
      };
    },
  },

  gateway_reconciliation: {
    title: "Gateway Reconciliation",
    category: "Online Payments",
    permission: "online_payments:reports",
    run: async (_f, inst) => {
      // Successful orders cross-checked against the fee payment they created.
      const rows = await rowsOf(
        `SELECT po.order_no AS "orderNo", i.invoice_no AS "invoiceNo",
                po.amount AS "orderAmount", p.amount AS "creditedAmount",
                po.gateway_payment_id AS "paymentRef",
                CASE WHEN p.id IS NULL THEN 'missing'
                     WHEN p.amount = po.amount THEN 'matched'
                     ELSE 'mismatch' END AS reconciliation
         FROM payment_orders po
         JOIN invoices i ON i.id = po.invoice_id
         LEFT JOIN payments p ON p.id = po.payment_id
         WHERE po.institution_id = $1 AND po.status = 'success'
         ORDER BY po.updated_at DESC`,
        [inst]
      );
      return {
        title: "Gateway Reconciliation",
        columns: [
          { key: "orderNo", label: "Order No" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "orderAmount", label: "Order Amount" },
          { key: "creditedAmount", label: "Credited" },
          { key: "paymentRef", label: "Payment Ref" },
          { key: "reconciliation", label: "Reconciliation" },
        ],
        rows,
      };
    },
  },

  fee_dues_class: {
    title: "Class-wise Dues",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT COALESCE(c.name, '—') AS class,
                count(DISTINCT i.student_id)::int AS students,
                COALESCE(sum(i.amount_due - i.amount_paid), 0) AS outstanding
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
         GROUP BY c.name ORDER BY outstanding DESC`,
        [inst]
      );
      return {
        title: "Class-wise Dues",
        columns: [
          { key: "class", label: "Class" },
          { key: "students", label: "Students" },
          { key: "outstanding", label: "Outstanding" },
        ],
        rows,
      };
    },
  },

  fee_dues_student: {
    title: "Student-wise Dues",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student, c.name AS class,
                count(*)::int AS invoices,
                COALESCE(sum(i.amount_due - i.amount_paid), 0) AS outstanding
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
         GROUP BY s.id, c.name ORDER BY outstanding DESC`,
        [inst]
      );
      return {
        title: "Student-wise Dues",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "class", label: "Class" },
          { key: "invoices", label: "Invoices" },
          { key: "outstanding", label: "Outstanding" },
        ],
        rows,
      };
    },
  },

  fee_dues_category: {
    title: "Category-wise Dues",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT COALESCE(cat.name, 'Uncategorized') AS category,
                count(*)::int AS invoices,
                COALESCE(sum(i.amount_due - i.amount_paid), 0) AS outstanding
         FROM invoices i
         LEFT JOIN fee_categories cat ON cat.id = i.category_id
         WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
         GROUP BY cat.name ORDER BY outstanding DESC`,
        [inst]
      );
      return {
        title: "Category-wise Dues",
        columns: [
          { key: "category", label: "Category" },
          { key: "invoices", label: "Invoices" },
          { key: "outstanding", label: "Outstanding" },
        ],
        rows,
      };
    },
  },

  fee_term_collection: {
    title: "Term-wise Collection",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT COALESCE(fs.term_label, fs.name, 'Ad-hoc') AS term,
                COALESCE(sum(i.amount_due), 0) AS billed,
                COALESCE(sum(i.amount_paid), 0) AS collected,
                COALESCE(sum(i.amount_due - i.amount_paid), 0) AS outstanding
         FROM invoices i
         LEFT JOIN fee_schedules fs ON fs.id = i.fee_schedule_id
         WHERE i.institution_id = $1 AND i.status <> 'cancelled'
         GROUP BY COALESCE(fs.term_label, fs.name, 'Ad-hoc') ORDER BY term`,
        [inst]
      );
      return {
        title: "Term-wise Collection",
        columns: [
          { key: "term", label: "Term" },
          { key: "billed", label: "Billed" },
          { key: "collected", label: "Collected" },
          { key: "outstanding", label: "Outstanding" },
        ],
        rows,
      };
    },
  },

  fee_fine_collection: {
    title: "Fine Collection",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                i.invoice_no AS "invoiceNo", f.amount, f.status,
                f.created_at AS "appliedAt"
         FROM invoice_fines f
         JOIN invoices i ON i.id = f.invoice_id
         JOIN students s ON s.id = i.student_id
         WHERE f.institution_id = $1 ORDER BY f.created_at DESC`,
        [inst]
      );
      return {
        title: "Fine Collection",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "amount", label: "Fine" },
          { key: "status", label: "Status" },
          { key: "appliedAt", label: "Applied" },
        ],
        rows,
      };
    },
  },

  fee_discount_report: {
    title: "Discounts & Scholarships",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                i.invoice_no AS "invoiceNo", d.amount, d.status, d.reason,
                d.created_at AS "appliedAt"
         FROM invoice_discounts d
         JOIN invoices i ON i.id = d.invoice_id
         JOIN students s ON s.id = d.student_id
         WHERE d.institution_id = $1 ORDER BY d.created_at DESC`,
        [inst]
      );
      return {
        title: "Discounts & Scholarships",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "amount", label: "Amount" },
          { key: "status", label: "Status" },
          { key: "reason", label: "Reason" },
          { key: "appliedAt", label: "Applied" },
        ],
        rows,
      };
    },
  },

  fee_outstanding: {
    title: "Outstanding Balances",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                i.invoice_no AS "invoiceNo", i.description,
                i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
                (i.amount_due - i.amount_paid) AS outstanding,
                to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", i.status
         FROM invoices i JOIN students s ON s.id = i.student_id
         WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
           AND (i.amount_due - i.amount_paid) > 0
         ORDER BY i.due_date`,
        [inst]
      );
      return {
        title: "Outstanding Balances",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "invoiceNo", label: "Invoice" },
          { key: "description", label: "Description" },
          { key: "amountDue", label: "Due" },
          { key: "amountPaid", label: "Paid" },
          { key: "outstanding", label: "Outstanding" },
          { key: "dueDate", label: "Due Date" },
          { key: "status", label: "Status" },
        ],
        rows,
      };
    },
  },

  fee_defaulters: {
    title: "Defaulters",
    category: "Fees",
    permission: "fee_reports:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student, c.name AS class,
                count(*)::int AS "overdueInvoices",
                COALESCE(sum(i.amount_due - i.amount_paid), 0) AS outstanding,
                min(to_char(i.due_date, 'YYYY-MM-DD')) AS "earliestDue"
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN sections sec ON sec.id = s.section_id
         LEFT JOIN classes c ON c.id = sec.class_id
         WHERE i.institution_id = $1 AND i.status IN ('pending','partially_paid')
           AND i.due_date < CURRENT_DATE
         GROUP BY s.id, c.name ORDER BY outstanding DESC`,
        [inst]
      );
      return {
        title: "Defaulters",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "class", label: "Class" },
          { key: "overdueInvoices", label: "Overdue Invoices" },
          { key: "outstanding", label: "Outstanding" },
          { key: "earliestDue", label: "Earliest Due" },
        ],
        rows,
      };
    },
  },

  tc_issued_register: {
    title: "TC Issued Register",
    category: "Transfer Certificates",
    permission: "transfer_certificates:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT tc.tc_no AS "tcNo", s.first_name || ' ' || s.last_name AS student,
                tc.admission_no AS "admissionNo", tc.class_name AS class,
                tc.section_name AS section,
                to_char(tc.date_of_issue, 'YYYY-MM-DD') AS "issueDate",
                tc.leaving_reason AS reason
         FROM transfer_certificates tc JOIN students s ON s.id = tc.student_id
         WHERE tc.institution_id = $1 AND tc.status = 'issued'
         ORDER BY tc.date_of_issue DESC NULLS LAST`,
        [inst]
      );
      return {
        title: "TC Issued Register",
        columns: [
          { key: "tcNo", label: "TC No" },
          { key: "student", label: "Student" },
          { key: "admissionNo", label: "Admission No" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "issueDate", label: "Issue Date" },
          { key: "reason", label: "Reason" },
        ],
        rows,
      };
    },
  },

  tc_cancelled: {
    title: "Cancelled TCs",
    category: "Transfer Certificates",
    permission: "transfer_certificates:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT tc.tc_no AS "tcNo", s.first_name || ' ' || s.last_name AS student,
                tc.admission_no AS "admissionNo",
                to_char(tc.cancelled_at, 'YYYY-MM-DD') AS "cancelledAt",
                tc.cancel_reason AS reason
         FROM transfer_certificates tc JOIN students s ON s.id = tc.student_id
         WHERE tc.institution_id = $1 AND tc.status = 'cancelled'
         ORDER BY tc.cancelled_at DESC NULLS LAST`,
        [inst]
      );
      return {
        title: "Cancelled TCs",
        columns: [
          { key: "tcNo", label: "TC No" },
          { key: "student", label: "Student" },
          { key: "admissionNo", label: "Admission No" },
          { key: "cancelledAt", label: "Cancelled" },
          { key: "reason", label: "Reason" },
        ],
        rows,
      };
    },
  },

  tc_student_leaving: {
    title: "Student Leaving Report",
    category: "Transfer Certificates",
    permission: "transfer_certificates:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT s.admission_no AS "admissionNo",
                s.first_name || ' ' || s.last_name AS student,
                tc.class_name AS class, tc.section_name AS section,
                to_char(tc.date_of_issue, 'YYYY-MM-DD') AS "leavingDate",
                tc.leaving_reason AS reason, s.status AS "studentStatus"
         FROM transfer_certificates tc JOIN students s ON s.id = tc.student_id
         WHERE tc.institution_id = $1 AND tc.status = 'issued'
         ORDER BY tc.date_of_issue DESC NULLS LAST`,
        [inst]
      );
      return {
        title: "Student Leaving Report",
        columns: [
          { key: "admissionNo", label: "Admission No" },
          { key: "student", label: "Student" },
          { key: "class", label: "Class" },
          { key: "section", label: "Section" },
          { key: "leavingDate", label: "Leaving Date" },
          { key: "reason", label: "Reason" },
          { key: "studentStatus", label: "Student Status" },
        ],
        rows,
      };
    },
  },

  tc_pending_draft: {
    title: "Pending / Draft TCs",
    category: "Transfer Certificates",
    permission: "transfer_certificates:read",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT tc.tc_no AS "tcNo", s.first_name || ' ' || s.last_name AS student,
                tc.admission_no AS "admissionNo", tc.class_name AS class,
                to_char(tc.created_at, 'YYYY-MM-DD') AS "createdAt"
         FROM transfer_certificates tc JOIN students s ON s.id = tc.student_id
         WHERE tc.institution_id = $1 AND tc.status = 'draft'
         ORDER BY tc.created_at DESC`,
        [inst]
      );
      return {
        title: "Pending / Draft TCs",
        columns: [
          { key: "tcNo", label: "TC No" },
          { key: "student", label: "Student" },
          { key: "admissionNo", label: "Admission No" },
          { key: "class", label: "Class" },
          { key: "createdAt", label: "Created" },
        ],
        rows,
      };
    },
  },

  thread_messaging_activity: {
    title: "Messaging Activity",
    category: "Messaging",
    permission: "threads:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT to_char(m.created_at::date, 'YYYY-MM-DD') AS date,
                count(DISTINCT m.thread_id)::int AS "activeThreads",
                count(*)::int AS messages
         FROM thread_messages m WHERE m.institution_id = $1
         GROUP BY m.created_at::date ORDER BY m.created_at::date DESC`,
        [inst]
      );
      return {
        title: "Messaging Activity",
        columns: [
          { key: "date", label: "Date" },
          { key: "activeThreads", label: "Active Threads" },
          { key: "messages", label: "Messages" },
        ],
        rows,
      };
    },
  },

  thread_volume_by_user: {
    title: "Thread Volume by User",
    category: "Messaging",
    permission: "threads:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT COALESCE(u.full_name, '(system)') AS "user", u.role,
                count(*)::int AS messages,
                count(DISTINCT m.thread_id)::int AS threads
         FROM thread_messages m LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.institution_id = $1
         GROUP BY u.full_name, u.role ORDER BY messages DESC`,
        [inst]
      );
      return {
        title: "Thread Volume by User",
        columns: [
          { key: "user", label: "User" },
          { key: "role", label: "Role" },
          { key: "messages", label: "Messages" },
          { key: "threads", label: "Threads" },
        ],
        rows,
      };
    },
  },

  thread_unread_messages: {
    title: "Unread Messages",
    category: "Messaging",
    permission: "threads:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT u.full_name AS "user", u.role, count(m.id)::int AS unread
         FROM thread_participants tp
         JOIN users u ON u.id = tp.user_id
         JOIN thread_messages m ON m.thread_id = tp.thread_id AND m.sender_id <> tp.user_id
           AND (tp.last_read_at IS NULL OR m.created_at > tp.last_read_at)
         WHERE tp.institution_id = $1 AND tp.archived_at IS NULL
         GROUP BY u.id, u.full_name, u.role
         HAVING count(m.id) > 0 ORDER BY unread DESC`,
        [inst]
      );
      return {
        title: "Unread Messages",
        columns: [
          { key: "user", label: "User" },
          { key: "role", label: "Role" },
          { key: "unread", label: "Unread" },
        ],
        rows,
      };
    },
  },

  thread_staff_parent: {
    title: "Staff–Parent Communication",
    category: "Messaging",
    permission: "threads:reports",
    run: async (_f, inst) => {
      const rows = await rowsOf(
        `SELECT t.subject, t.type, to_char(t.created_at, 'YYYY-MM-DD') AS created,
                (SELECT count(*)::int FROM thread_messages m WHERE m.thread_id = t.id) AS messages
         FROM threads t
         WHERE t.institution_id = $1
           AND EXISTS (SELECT 1 FROM thread_participants p JOIN users u ON u.id = p.user_id
                       WHERE p.thread_id = t.id AND u.role IN ('admin','teacher','accountant'))
           AND EXISTS (SELECT 1 FROM thread_participants p JOIN users u ON u.id = p.user_id
                       WHERE p.thread_id = t.id AND u.role = 'parent')
         ORDER BY t.last_message_at DESC`,
        [inst]
      );
      return {
        title: "Staff–Parent Communication",
        columns: [
          { key: "subject", label: "Subject" },
          { key: "type", label: "Type" },
          { key: "created", label: "Created" },
          { key: "messages", label: "Messages" },
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
