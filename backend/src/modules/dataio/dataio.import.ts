// PR-T5 — importable entities for the tenant Import/Export center.
//
// Each entity: toInput (CSV record → typed input + shape errors) → validate
// (batched, read-only: intra-batch dupes, in-tenant FK resolution, existing-key
// dupes) → commit (atomic). Students/teachers reuse the existing atomic bulk
// importers; the rest do direct transactional INSERTs so a whole batch is
// all-or-nothing. Human-friendly natural keys (codes/names/numbers) are resolved
// to in-tenant UUIDs during validate and stashed on the input for commit.

import { z, ZodError } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { createStudentSchema, importStudentsSchema } from "../students/students.schema";
import { createTeacherSchema, importTeachersSchema } from "../teachers/teachers.schema";
import { importStudents } from "../students/students.service";
import { importTeachers } from "../teachers/teachers.service";
import type { ImportEntity, RowError } from "./dataio.types";

// --- shared helpers ---------------------------------------------------------

const zErrors = (err: ZodError): RowError[] =>
  err.issues.map((i) => ({ field: String(i.path[0] ?? "row"), message: i.message }));

/** Empty CSV cell → undefined (so zod .optional() applies). */
const s = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
};
/** Numeric CSV cell → number | undefined (NaN when non-numeric, so zod flags it). */
const n = (v: string | undefined): number | undefined => {
  const t = (v ?? "").trim();
  if (t === "") return undefined;
  const num = Number(t);
  return Number.isNaN(num) ? NaN : num;
};

/** Fetch a per-tenant Map from a text key to id (for FK-by-human-key resolution). */
async function keyToId(
  institutionId: string,
  sql: string
): Promise<Map<string, string>> {
  const { rows } = await query<{ k: string; id: string }>(sql, [institutionId]);
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.k, r.id);
  return m;
}

/** Set of existing natural keys in a tenant (for duplicate detection). */
async function existingKeys(institutionId: string, sql: string): Promise<Set<string>> {
  const { rows } = await query<{ k: string }>(sql, [institutionId]);
  return new Set(rows.map((r) => r.k));
}

const norm = (v: string) => v.trim().toLowerCase();

// ===========================================================================
// SUBJECTS (school + college) — {name, code}; code unique per tenant
// ===========================================================================
interface SubjectIn { name: string; code: string }
const subjects: ImportEntity<SubjectIn> = {
  key: "subjects",
  label: "Subjects / Courses",
  appliesTo: "both",
  permission: "subjects:manage",
  columns: [
    { field: "name", required: true },
    { field: "code", required: true, note: "Unique per institution; stored uppercase" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ name: z.string().min(1).max(100), code: z.string().min(1).max(20) })
      .safeParse({ name: s(rec.name), code: s(rec.code) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const existing = await existingKeys(
      inst,
      `SELECT upper(code) AS k FROM subjects WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const code = inp.code.toUpperCase();
      const errs: RowError[] = [];
      if (existing.has(code)) errs.push({ field: "code", message: `Subject code "${inp.code}" already exists` });
      if (seen.has(code)) errs.push({ field: "code", message: `Duplicate code "${inp.code}" in this file` });
      seen.add(code);
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`INSERT INTO subjects (institution_id, name, code) VALUES ($1,$2,$3)`, [
          inst, i.name, i.code.toUpperCase(),
        ]);
      return inputs.length;
    });
  },
};
// ===========================================================================
// CLASSES (school) — {name, gradeLevel}; name unique per tenant
// ===========================================================================
interface ClassIn { name: string; gradeLevel: number }
const classes: ImportEntity<ClassIn> = {
  key: "classes",
  label: "Classes",
  appliesTo: "school",
  permission: "classes:manage",
  columns: [
    { field: "name", required: true, note: "Unique per institution" },
    { field: "gradeLevel", required: true, note: "Integer 0–20" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ name: z.string().min(1).max(100), gradeLevel: z.number().int().min(0).max(20) })
      .safeParse({ name: s(rec.name), gradeLevel: n(rec.gradeLevel) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const existing = await existingKeys(inst, `SELECT lower(name) AS k FROM classes WHERE institution_id = $1`);
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const key = norm(inp.name);
      if (existing.has(key)) errs.push({ field: "name", message: `Class "${inp.name}" already exists` });
      if (seen.has(key)) errs.push({ field: "name", message: `Duplicate class "${inp.name}" in this file` });
      seen.add(key);
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,$2,$3)`, [
          inst, i.name, i.gradeLevel,
        ]);
      return inputs.length;
    });
  },
};

// ===========================================================================
// SECTIONS (school) — {className, sectionName, capacity?}; (class,name) unique
// ===========================================================================
interface SectionIn { className: string; sectionName: string; capacity?: number; _classId?: string }
const sections: ImportEntity<SectionIn> = {
  key: "sections",
  label: "Sections",
  appliesTo: "school",
  permission: "sections:manage",
  columns: [
    { field: "className", required: true, note: "Must be an existing class" },
    { field: "sectionName", required: true },
    { field: "capacity", note: "Integer > 0 (default 40)" },
  ],
  toInput(rec) {
    const parsed = z
      .object({
        className: z.string().min(1).max(100),
        sectionName: z.string().min(1).max(20),
        capacity: z.number().int().positive().optional(),
      })
      .safeParse({ className: s(rec.className), sectionName: s(rec.sectionName), capacity: n(rec.capacity) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const classMap = await keyToId(inst, `SELECT lower(name) AS k, id FROM classes WHERE institution_id = $1`);
    const existing = await existingKeys(
      inst,
      `SELECT lower(c.name) || '::' || lower(sec.name) AS k
       FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const classId = classMap.get(norm(inp.className));
      if (!classId) errs.push({ field: "className", message: `Class "${inp.className}" not found` });
      else inp._classId = classId;
      const key = `${norm(inp.className)}::${norm(inp.sectionName)}`;
      if (existing.has(key)) errs.push({ field: "sectionName", message: `Section "${inp.sectionName}" already exists in ${inp.className}` });
      if (seen.has(key)) errs.push({ field: "sectionName", message: `Duplicate section in this file` });
      seen.add(key);
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO sections (institution_id, class_id, name, capacity) VALUES ($1,$2,$3,COALESCE($4,40))`,
          [inst, i._classId, i.sectionName, i.capacity ?? null]
        );
      return inputs.length;
    });
  },
};

// ===========================================================================
// STUDENTS (school + college) — demographics; reuse the atomic bulk importer
// ===========================================================================
type StudentIn = z.infer<typeof createStudentSchema>;
const students: ImportEntity<StudentIn> = {
  key: "students",
  label: "Students",
  appliesTo: "both",
  permission: "students:import",
  columns: [
    { field: "firstName", required: true },
    { field: "lastName", required: true },
    { field: "admissionNo", note: "Optional; auto-generated per institution when blank" },
    { field: "dateOfBirth", note: "YYYY-MM-DD" },
    { field: "gender", note: "male | female | other" },
    { field: "guardianName" }, { field: "guardianPhone" }, { field: "guardianEmail" },
    { field: "guardianRelation", note: "father | mother | guardian | other" },
    { field: "address" }, { field: "rollNumber" }, { field: "bloodGroup" },
  ],
  toInput(rec) {
    const raw: Record<string, unknown> = {
      admissionNo: s(rec.admissionNo), firstName: s(rec.firstName), lastName: s(rec.lastName),
      dateOfBirth: s(rec.dateOfBirth), gender: s(rec.gender), guardianName: s(rec.guardianName),
      guardianPhone: s(rec.guardianPhone), guardianEmail: s(rec.guardianEmail),
      guardianRelation: s(rec.guardianRelation), address: s(rec.address), rollNumber: s(rec.rollNumber),
      bloodGroup: s(rec.bloodGroup), nationality: s(rec.nationality), religion: s(rec.religion),
      category: s(rec.category),
    };
    const parsed = createStudentSchema.safeParse(raw);
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const existing = await existingKeys(
      inst,
      `SELECT lower(admission_no) AS k FROM students WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      if (inp.admissionNo) {
        const key = norm(inp.admissionNo);
        if (existing.has(key)) errs.push({ field: "admissionNo", message: `Admission no "${inp.admissionNo}" already exists` });
        if (seen.has(key)) errs.push({ field: "admissionNo", message: `Duplicate admission no in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    // importStudents validates its own schema + is transactional (all-or-nothing).
    const validated = importStudentsSchema.parse({ rows: inputs });
    const { imported } = await importStudents(validated.rows, inst);
    return imported;
  },
};

// ===========================================================================
// TEACHERS / FACULTY — reuse the atomic bulk importer
// ===========================================================================
type TeacherIn = z.infer<typeof createTeacherSchema>;
const teachers: ImportEntity<TeacherIn> = {
  key: "teachers",
  label: "Teachers / Faculty",
  appliesTo: "both",
  permission: "teachers:manage",
  columns: [
    { field: "firstName", required: true }, { field: "lastName", required: true },
    { field: "employeeNo", note: "Optional; auto-generated per institution when blank" },
    { field: "email" }, { field: "phone" }, { field: "qualification" }, { field: "specialization" },
    { field: "joiningDate", note: "YYYY-MM-DD" },
    { field: "staffType", note: "teaching | non_teaching (default teaching)" },
    { field: "designation", note: "Role title for non-teaching staff (e.g. Accountant)" },
    { field: "department", note: "Optional non-teaching department" },
  ],
  toInput(rec) {
    const parsed = createTeacherSchema.safeParse({
      employeeNo: s(rec.employeeNo), firstName: s(rec.firstName), lastName: s(rec.lastName),
      email: s(rec.email), phone: s(rec.phone), qualification: s(rec.qualification),
      specialization: s(rec.specialization), joiningDate: s(rec.joiningDate),
      staffType: s(rec.staffType), designation: s(rec.designation), department: s(rec.department),
    });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const existing = await existingKeys(inst, `SELECT lower(employee_no) AS k FROM teachers WHERE institution_id = $1`);
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      if (inp.employeeNo) {
        const key = norm(inp.employeeNo);
        if (existing.has(key)) errs.push({ field: "employeeNo", message: `Employee no "${inp.employeeNo}" already exists` });
        if (seen.has(key)) errs.push({ field: "employeeNo", message: `Duplicate employee no in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    const validated = importTeachersSchema.parse({ rows: inputs });
    const { imported } = await importTeachers(validated.rows, inst);
    return imported;
  },
};

// ===========================================================================
// GUARDIANS — link an existing parent user to a student (both in tenant)
// ===========================================================================
interface GuardianIn { admissionNo: string; parentEmail: string; relationship?: string; _studentId?: string; _userId?: string }
const guardians: ImportEntity<GuardianIn> = {
  key: "guardians",
  label: "Guardians / Parents (link)",
  appliesTo: "both",
  permission: "students:update",
  columns: [
    { field: "admissionNo", required: true, note: "Existing student's admission no" },
    { field: "parentEmail", required: true, note: "Existing parent-account email in this institution" },
    { field: "relationship", note: "e.g. father / mother / guardian" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ admissionNo: z.string().min(1), parentEmail: z.string().email(), relationship: z.string().max(50).optional() })
      .safeParse({ admissionNo: s(rec.admissionNo), parentEmail: s(rec.parentEmail), relationship: s(rec.relationship) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const studentMap = await keyToId(inst, `SELECT lower(admission_no) AS k, id FROM students WHERE institution_id = $1`);
    const parents = await keyToId(
      inst,
      `SELECT lower(email) AS k, id FROM users WHERE institution_id = $1 AND role = 'parent'`
    );
    const existing = await existingKeys(
      inst,
      `SELECT user_id || '::' || student_id AS k FROM guardians WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const studentId = studentMap.get(norm(inp.admissionNo));
      const userId = parents.get(norm(inp.parentEmail));
      if (!studentId) errs.push({ field: "admissionNo", message: `Student "${inp.admissionNo}" not found` });
      else inp._studentId = studentId;
      if (!userId) errs.push({ field: "parentEmail", message: `No parent account for "${inp.parentEmail}" in this institution` });
      else inp._userId = userId;
      if (studentId && userId) {
        const key = `${userId}::${studentId}`;
        if (existing.has(key)) errs.push({ field: "parentEmail", message: `Already linked to this student` });
        if (seen.has(key)) errs.push({ field: "parentEmail", message: `Duplicate link in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO guardians (institution_id, user_id, student_id, relationship)
           VALUES ($1,$2,$3,COALESCE($4,'guardian')) ON CONFLICT (user_id, student_id) DO NOTHING`,
          [inst, i._userId, i._studentId, i.relationship ?? null]
        );
      return inputs.length;
    });
  },
};

// ===========================================================================
// COLLEGE: DEPARTMENTS, PROGRAMS, SEMESTERS, BATCHES, COURSES
// ===========================================================================
interface DepartmentIn { name: string; code: string }
const departments: ImportEntity<DepartmentIn> = {
  key: "departments",
  label: "Departments (College)",
  appliesTo: "college",
  permission: "departments:create",
  columns: [{ field: "name", required: true }, { field: "code", required: true, note: "Unique per institution" }],
  toInput(rec) {
    const parsed = z.object({ name: z.string().min(1).max(160), code: z.string().min(1).max(40) })
      .safeParse({ name: s(rec.name), code: s(rec.code) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const existing = await existingKeys(inst, `SELECT lower(code) AS k FROM departments WHERE institution_id = $1`);
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const key = norm(inp.code);
      if (existing.has(key)) errs.push({ field: "code", message: `Department code "${inp.code}" already exists` });
      if (seen.has(key)) errs.push({ field: "code", message: `Duplicate code in this file` });
      seen.add(key);
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`INSERT INTO departments (institution_id, name, code) VALUES ($1,$2,$3)`, [inst, i.name, i.code]);
      return inputs.length;
    });
  },
};

interface ProgramIn { departmentCode: string; name: string; code: string; durationSemesters?: number; _deptId?: string }
const programs: ImportEntity<ProgramIn> = {
  key: "programs",
  label: "Programs (College)",
  appliesTo: "college",
  permission: "programs:create",
  columns: [
    { field: "departmentCode", required: true, note: "Existing department code" },
    { field: "name", required: true }, { field: "code", required: true, note: "Unique per institution" },
    { field: "durationSemesters", note: "Integer 1–20" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ departmentCode: z.string().min(1), name: z.string().min(1).max(160), code: z.string().min(1).max(40), durationSemesters: z.number().int().min(1).max(20).optional() })
      .safeParse({ departmentCode: s(rec.departmentCode), name: s(rec.name), code: s(rec.code), durationSemesters: n(rec.durationSemesters) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const depts = await keyToId(inst, `SELECT lower(code) AS k, id FROM departments WHERE institution_id = $1`);
    const existing = await existingKeys(inst, `SELECT lower(code) AS k FROM programs WHERE institution_id = $1`);
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const deptId = depts.get(norm(inp.departmentCode));
      if (!deptId) errs.push({ field: "departmentCode", message: `Department "${inp.departmentCode}" not found` });
      else inp._deptId = deptId;
      const key = norm(inp.code);
      if (existing.has(key)) errs.push({ field: "code", message: `Program code "${inp.code}" already exists` });
      if (seen.has(key)) errs.push({ field: "code", message: `Duplicate code in this file` });
      seen.add(key);
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO programs (institution_id, department_id, name, code, duration_semesters)
           VALUES ($1,$2,$3,$4,COALESCE($5,6))`,
          [inst, i._deptId, i.name, i.code, i.durationSemesters ?? null]
        );
      return inputs.length;
    });
  },
};

interface SemesterIn { programCode: string; name: string; number: number; _programId?: string }
const semesters: ImportEntity<SemesterIn> = {
  key: "semesters",
  label: "Semesters (College)",
  appliesTo: "college",
  permission: "semesters:create",
  columns: [
    { field: "programCode", required: true, note: "Existing program code" },
    { field: "name", required: true }, { field: "number", required: true, note: "Integer 1–20; unique within program" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ programCode: z.string().min(1), name: z.string().min(1).max(80), number: z.number().int().min(1).max(20) })
      .safeParse({ programCode: s(rec.programCode), name: s(rec.name), number: n(rec.number) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const progs = await keyToId(inst, `SELECT lower(code) AS k, id FROM programs WHERE institution_id = $1`);
    const existing = await existingKeys(
      inst,
      `SELECT program_id || '::' || number AS k FROM semesters WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const programId = progs.get(norm(inp.programCode));
      if (!programId) errs.push({ field: "programCode", message: `Program "${inp.programCode}" not found` });
      else {
        inp._programId = programId;
        const key = `${programId}::${inp.number}`;
        if (existing.has(key)) errs.push({ field: "number", message: `Semester ${inp.number} already exists in ${inp.programCode}` });
        if (seen.has(key)) errs.push({ field: "number", message: `Duplicate semester in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`INSERT INTO semesters (institution_id, program_id, name, number) VALUES ($1,$2,$3,$4)`, [
          inst, i._programId, i.name, i.number,
        ]);
      return inputs.length;
    });
  },
};

interface BatchIn { programCode: string; name: string; startYear?: number; _programId?: string }
const batches: ImportEntity<BatchIn> = {
  key: "batches",
  label: "Batches (College)",
  appliesTo: "college",
  permission: "college:create",
  columns: [
    { field: "programCode", required: true, note: "Existing program code" },
    { field: "name", required: true, note: "Unique within program" }, { field: "startYear", note: "Integer year" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ programCode: z.string().min(1), name: z.string().min(1).max(80), startYear: z.number().int().min(1900).max(2200).optional() })
      .safeParse({ programCode: s(rec.programCode), name: s(rec.name), startYear: n(rec.startYear) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const progs = await keyToId(inst, `SELECT lower(code) AS k, id FROM programs WHERE institution_id = $1`);
    const existing = await existingKeys(
      inst,
      `SELECT program_id || '::' || lower(name) AS k FROM batches WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const programId = progs.get(norm(inp.programCode));
      if (!programId) errs.push({ field: "programCode", message: `Program "${inp.programCode}" not found` });
      else {
        inp._programId = programId;
        const key = `${programId}::${norm(inp.name)}`;
        if (existing.has(key)) errs.push({ field: "name", message: `Batch "${inp.name}" already exists in ${inp.programCode}` });
        if (seen.has(key)) errs.push({ field: "name", message: `Duplicate batch in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`INSERT INTO batches (institution_id, program_id, name, start_year) VALUES ($1,$2,$3,$4)`, [
          inst, i._programId, i.name, i.startYear ?? null,
        ]);
      return inputs.length;
    });
  },
};

interface CourseIn { programCode: string; subjectCode: string; semesterNumber?: number; credits?: number; _programId?: string; _subjectId?: string; _semesterId?: string | null }
const courses: ImportEntity<CourseIn> = {
  key: "courses",
  label: "Program Courses (College curriculum)",
  appliesTo: "college",
  permission: "college:create",
  columns: [
    { field: "programCode", required: true, note: "Existing program code" },
    { field: "subjectCode", required: true, note: "Existing subject code" },
    { field: "semesterNumber", note: "Existing semester number in the program (optional)" },
    { field: "credits", note: "0–20 (default 3)" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ programCode: z.string().min(1), subjectCode: z.string().min(1), semesterNumber: z.number().int().min(1).max(20).optional(), credits: z.number().min(0).max(20).optional() })
      .safeParse({ programCode: s(rec.programCode), subjectCode: s(rec.subjectCode), semesterNumber: n(rec.semesterNumber), credits: n(rec.credits) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const progs = await keyToId(inst, `SELECT lower(code) AS k, id FROM programs WHERE institution_id = $1`);
    const subs = await keyToId(inst, `SELECT upper(code) AS k, id FROM subjects WHERE institution_id = $1`);
    const sems = await keyToId(inst, `SELECT program_id || '::' || number AS k, id FROM semesters WHERE institution_id = $1`);
    const existing = await existingKeys(
      inst,
      `SELECT COALESCE(semester_id::text,'none') || '::' || subject_id AS k FROM program_subjects WHERE institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const programId = progs.get(norm(inp.programCode));
      const subjectId = subs.get(inp.subjectCode.toUpperCase());
      if (!programId) errs.push({ field: "programCode", message: `Program "${inp.programCode}" not found` });
      else inp._programId = programId;
      if (!subjectId) errs.push({ field: "subjectCode", message: `Subject "${inp.subjectCode}" not found` });
      else inp._subjectId = subjectId;
      let semId: string | null = null;
      if (inp.semesterNumber !== undefined) {
        if (programId) {
          semId = sems.get(`${programId}::${inp.semesterNumber}`) ?? null;
          if (!semId) errs.push({ field: "semesterNumber", message: `Semester ${inp.semesterNumber} not found in ${inp.programCode}` });
        }
      }
      inp._semesterId = semId;
      if (subjectId) {
        const key = `${semId ?? "none"}::${subjectId}`;
        if (existing.has(key)) errs.push({ field: "subjectCode", message: `Course already mapped for this semester` });
        if (seen.has(key)) errs.push({ field: "subjectCode", message: `Duplicate course in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO program_subjects (institution_id, program_id, subject_id, semester_id, credits)
           VALUES ($1,$2,$3,$4,COALESCE($5,3))`,
          [inst, i._programId, i._subjectId, i._semesterId ?? null, i.credits ?? null]
        );
      return inputs.length;
    });
  },
};

// ===========================================================================
// ASSIGNMENTS — place students / assign teachers (basic, human-key resolved)
// ===========================================================================

// Student → section (school): sets students.section_id by admission no + class/section.
interface PlacementIn { admissionNo: string; className: string; sectionName: string; _studentId?: string; _sectionId?: string }
const studentPlacement: ImportEntity<PlacementIn> = {
  key: "student_placement",
  label: "Student Section Placement (School)",
  appliesTo: "school",
  permission: "students:update",
  columns: [
    { field: "admissionNo", required: true, note: "Existing student's admission no" },
    { field: "className", required: true }, { field: "sectionName", required: true },
  ],
  toInput(rec) {
    const parsed = z
      .object({ admissionNo: z.string().min(1), className: z.string().min(1), sectionName: z.string().min(1) })
      .safeParse({ admissionNo: s(rec.admissionNo), className: s(rec.className), sectionName: s(rec.sectionName) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const studentMap = await keyToId(inst, `SELECT lower(admission_no) AS k, id FROM students WHERE institution_id = $1`);
    const sectionMap = await keyToId(
      inst,
      `SELECT lower(c.name) || '::' || lower(sec.name) AS k, sec.id
       FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.institution_id = $1`
    );
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const studentId = studentMap.get(norm(inp.admissionNo));
      const sectionId = sectionMap.get(`${norm(inp.className)}::${norm(inp.sectionName)}`);
      if (!studentId) errs.push({ field: "admissionNo", message: `Student "${inp.admissionNo}" not found` });
      else inp._studentId = studentId;
      if (!sectionId) errs.push({ field: "sectionName", message: `Section "${inp.className} / ${inp.sectionName}" not found` });
      else inp._sectionId = sectionId;
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(`UPDATE students SET section_id = $1, updated_at = now() WHERE id = $2 AND institution_id = $3`, [
          i._sectionId, i._studentId, inst,
        ]);
      return inputs.length;
    });
  },
};

// Student → program/semester/batch (college enrollment).
interface EnrollIn { admissionNo: string; programCode: string; semesterNumber?: number; batchName?: string; status?: string; _studentId?: string; _programId?: string; _semesterId?: string | null; _batchId?: string | null }
const studentEnrollment: ImportEntity<EnrollIn> = {
  key: "student_enrollment",
  label: "Student Enrollment (College)",
  appliesTo: "college",
  permission: "college:create",
  columns: [
    { field: "admissionNo", required: true }, { field: "programCode", required: true },
    { field: "semesterNumber", note: "Optional semester number in the program" },
    { field: "batchName", note: "Optional batch name in the program" },
    { field: "status", note: "Optional (default active)" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ admissionNo: z.string().min(1), programCode: z.string().min(1), semesterNumber: z.number().int().min(1).max(20).optional(), batchName: z.string().max(80).optional(), status: z.string().max(40).optional() })
      .safeParse({ admissionNo: s(rec.admissionNo), programCode: s(rec.programCode), semesterNumber: n(rec.semesterNumber), batchName: s(rec.batchName), status: s(rec.status) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const studentMap = await keyToId(inst, `SELECT lower(admission_no) AS k, id FROM students WHERE institution_id = $1`);
    const progMap = await keyToId(inst, `SELECT lower(code) AS k, id FROM programs WHERE institution_id = $1`);
    const semMap = await keyToId(inst, `SELECT program_id || '::' || number AS k, id FROM semesters WHERE institution_id = $1`);
    const batchMap = await keyToId(inst, `SELECT program_id || '::' || lower(name) AS k, id FROM batches WHERE institution_id = $1`);
    const existing = await existingKeys(inst, `SELECT student_id || '::' || program_id AS k FROM enrollments WHERE institution_id = $1`);
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const studentId = studentMap.get(norm(inp.admissionNo));
      const programId = progMap.get(norm(inp.programCode));
      if (!studentId) errs.push({ field: "admissionNo", message: `Student "${inp.admissionNo}" not found` });
      else inp._studentId = studentId;
      if (!programId) errs.push({ field: "programCode", message: `Program "${inp.programCode}" not found` });
      else inp._programId = programId;
      if (programId && inp.semesterNumber !== undefined) {
        inp._semesterId = semMap.get(`${programId}::${inp.semesterNumber}`) ?? null;
        if (!inp._semesterId) errs.push({ field: "semesterNumber", message: `Semester ${inp.semesterNumber} not found in ${inp.programCode}` });
      }
      if (programId && inp.batchName) {
        inp._batchId = batchMap.get(`${programId}::${norm(inp.batchName)}`) ?? null;
        if (!inp._batchId) errs.push({ field: "batchName", message: `Batch "${inp.batchName}" not found in ${inp.programCode}` });
      }
      if (studentId && programId) {
        const key = `${studentId}::${programId}`;
        if (existing.has(key)) errs.push({ field: "admissionNo", message: `Already enrolled in ${inp.programCode}` });
        if (seen.has(key)) errs.push({ field: "admissionNo", message: `Duplicate enrollment in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO enrollments (institution_id, student_id, program_id, semester_id, batch_id, status)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,'active'))`,
          [inst, i._studentId, i._programId, i._semesterId ?? null, i._batchId ?? null, i.status ?? null]
        );
      return inputs.length;
    });
  },
};

// Teacher → section-subject (school class_subjects). Note: class_subjects has no
// institution_id; it is scoped via the (in-tenant) section.
interface SectionSubjectIn { className: string; sectionName: string; subjectCode: string; employeeNo?: string; _sectionId?: string; _subjectId?: string; _teacherId?: string | null }
const sectionSubject: ImportEntity<SectionSubjectIn> = {
  key: "section_subject",
  label: "Section Subject Assignment (School)",
  appliesTo: "school",
  permission: "subjects:manage",
  columns: [
    { field: "className", required: true }, { field: "sectionName", required: true },
    { field: "subjectCode", required: true, note: "Existing subject code" },
    { field: "employeeNo", note: "Optional teacher to assign" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ className: z.string().min(1), sectionName: z.string().min(1), subjectCode: z.string().min(1), employeeNo: z.string().max(50).optional() })
      .safeParse({ className: s(rec.className), sectionName: s(rec.sectionName), subjectCode: s(rec.subjectCode), employeeNo: s(rec.employeeNo) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const sectionMap = await keyToId(
      inst,
      `SELECT lower(c.name) || '::' || lower(sec.name) AS k, sec.id
       FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.institution_id = $1`
    );
    const subMap = await keyToId(inst, `SELECT upper(code) AS k, id FROM subjects WHERE institution_id = $1`);
    const teacherMap = await keyToId(inst, `SELECT lower(employee_no) AS k, id FROM teachers WHERE institution_id = $1`);
    const existing = await existingKeys(
      inst,
      `SELECT cs.section_id || '::' || cs.subject_id AS k FROM class_subjects cs
       JOIN sections sec ON sec.id = cs.section_id WHERE sec.institution_id = $1`
    );
    const seen = new Set<string>();
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const sectionId = sectionMap.get(`${norm(inp.className)}::${norm(inp.sectionName)}`);
      const subjectId = subMap.get(inp.subjectCode.toUpperCase());
      if (!sectionId) errs.push({ field: "sectionName", message: `Section "${inp.className} / ${inp.sectionName}" not found` });
      else inp._sectionId = sectionId;
      if (!subjectId) errs.push({ field: "subjectCode", message: `Subject "${inp.subjectCode}" not found` });
      else inp._subjectId = subjectId;
      if (inp.employeeNo) {
        inp._teacherId = teacherMap.get(norm(inp.employeeNo)) ?? null;
        if (!inp._teacherId) errs.push({ field: "employeeNo", message: `Teacher "${inp.employeeNo}" not found` });
      }
      if (sectionId && subjectId) {
        const key = `${sectionId}::${subjectId}`;
        if (existing.has(key)) errs.push({ field: "subjectCode", message: `Subject already assigned to this section` });
        if (seen.has(key)) errs.push({ field: "subjectCode", message: `Duplicate assignment in this file` });
        seen.add(key);
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO class_subjects (institution_id, section_id, subject_id, teacher_id) VALUES ($1,$2,$3,$4)`,
          [inst, i._sectionId, i._subjectId, i._teacherId ?? null]
        );
      return inputs.length;
    });
  },
};

// Faculty → department/program/subject (college staff_allocations).
interface StaffAllocIn { employeeNo: string; departmentCode?: string; programCode?: string; subjectCode?: string; _teacherId?: string; _deptId?: string | null; _programId?: string | null; _subjectId?: string | null }
const staffAllocation: ImportEntity<StaffAllocIn> = {
  key: "staff_allocation",
  label: "Faculty Allocation (College)",
  appliesTo: "college",
  permission: "college:create",
  columns: [
    { field: "employeeNo", required: true, note: "Existing faculty employee no" },
    { field: "departmentCode", note: "One of department/program/subject required" },
    { field: "programCode" }, { field: "subjectCode" },
  ],
  toInput(rec) {
    const parsed = z
      .object({ employeeNo: z.string().min(1), departmentCode: z.string().max(40).optional(), programCode: z.string().max(40).optional(), subjectCode: z.string().max(20).optional() })
      .refine((d) => d.departmentCode || d.programCode || d.subjectCode, { message: "Provide at least one of department/program/subject", path: ["departmentCode"] })
      .safeParse({ employeeNo: s(rec.employeeNo), departmentCode: s(rec.departmentCode), programCode: s(rec.programCode), subjectCode: s(rec.subjectCode) });
    return parsed.success ? { input: parsed.data, errors: [] } : { errors: zErrors(parsed.error) };
  },
  async validate(inputs, inst) {
    const teacherMap = await keyToId(inst, `SELECT lower(employee_no) AS k, id FROM teachers WHERE institution_id = $1`);
    const deptMap = await keyToId(inst, `SELECT lower(code) AS k, id FROM departments WHERE institution_id = $1`);
    const progMap = await keyToId(inst, `SELECT lower(code) AS k, id FROM programs WHERE institution_id = $1`);
    const subMap = await keyToId(inst, `SELECT upper(code) AS k, id FROM subjects WHERE institution_id = $1`);
    return inputs.map((inp) => {
      if (!inp) return [];
      const errs: RowError[] = [];
      const teacherId = teacherMap.get(norm(inp.employeeNo));
      if (!teacherId) errs.push({ field: "employeeNo", message: `Faculty "${inp.employeeNo}" not found` });
      else inp._teacherId = teacherId;
      if (inp.departmentCode) {
        inp._deptId = deptMap.get(norm(inp.departmentCode)) ?? null;
        if (!inp._deptId) errs.push({ field: "departmentCode", message: `Department "${inp.departmentCode}" not found` });
      }
      if (inp.programCode) {
        inp._programId = progMap.get(norm(inp.programCode)) ?? null;
        if (!inp._programId) errs.push({ field: "programCode", message: `Program "${inp.programCode}" not found` });
      }
      if (inp.subjectCode) {
        inp._subjectId = subMap.get(inp.subjectCode.toUpperCase()) ?? null;
        if (!inp._subjectId) errs.push({ field: "subjectCode", message: `Subject "${inp.subjectCode}" not found` });
      }
      return errs;
    });
  },
  async commit(inputs, inst) {
    return withTransaction(async (c) => {
      for (const i of inputs)
        await c.query(
          `INSERT INTO staff_allocations (institution_id, teacher_id, department_id, program_id, subject_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [inst, i._teacherId, i._deptId ?? null, i._programId ?? null, i._subjectId ?? null]
        );
      return inputs.length;
    });
  },
};

/** Import entities registered in the center (school + college). */
export const IMPORT_ENTITIES: ImportEntity[] = [
  classes as ImportEntity,
  sections as ImportEntity,
  subjects as ImportEntity,
  students as ImportEntity,
  guardians as ImportEntity,
  teachers as ImportEntity,
  departments as ImportEntity,
  programs as ImportEntity,
  semesters as ImportEntity,
  batches as ImportEntity,
  courses as ImportEntity,
  studentPlacement as ImportEntity,
  studentEnrollment as ImportEntity,
  sectionSubject as ImportEntity,
  staffAllocation as ImportEntity,
];

export const IMPORT_BY_KEY: Record<string, ImportEntity> = Object.fromEntries(
  IMPORT_ENTITIES.map((e) => [e.key, e])
);
