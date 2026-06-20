// Bulk "seed scale" data generator for performance testing. Creates multiple
// institutions, each with classes/sections, staff, students, attendance, invoices
// + payments, and homework — enough volume to measure the hot read endpoints
// realistically. Run against a DISPOSABLE database only (it inserts deterministic
// codes/emails, so re-run after a reset). Never run in CI.
//
// Usage (env, all optional):
//   PERF_INSTITUTIONS=2 PERF_STUDENTS=400 PERF_TEACHERS=40 PERF_CLASSES=6 \
//   PERF_ATTENDANCE_DAYS=3 PERF_ADMIN_PASSWORD=Perf@12345 \
//   npm run perf:seed

import { pool, query } from "../src/db/postgres";
import { runMigrations } from "../src/db/migrate";
import { hashPassword } from "../src/utils/password";

const num = (key: string, def: number) => Math.max(0, Number(process.env[key] ?? def));

const INSTITUTIONS = num("PERF_INSTITUTIONS", 2);
const STUDENTS = num("PERF_STUDENTS", 400);
const TEACHERS = num("PERF_TEACHERS", 40);
const CLASSES = num("PERF_CLASSES", 6);
const SECTIONS_PER_CLASS = num("PERF_SECTIONS_PER_CLASS", 3);
const SUBJECTS = num("PERF_SUBJECTS", 5);
const ATTENDANCE_DAYS = num("PERF_ATTENDANCE_DAYS", 3);
const ADMIN_PASSWORD = process.env.PERF_ADMIN_PASSWORD ?? "Perf@12345";
const SUPER_EMAIL = "perfsuper@sreedo.edu";

/** Chunked multi-row INSERT; returns the RETURNING column for every row in order. */
async function insertMany(
  table: string,
  columns: string[],
  rows: unknown[][],
  returning = "id"
): Promise<string[]> {
  const ids: string[] = [];
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((row) => `(${row.map((val) => { params.push(val); return `$${params.length}`; }).join(", ")})`)
      .join(", ");
    const { rows: out } = await query<Record<string, string>>(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valuesSql} RETURNING ${returning}`,
      params
    );
    for (const r of out) ids.push(r[returning]);
  }
  return ids;
}

function dateBack(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function seedInstitution(index: number, passwordHash: string): Promise<void> {
  const code = `PERF${index}`;
  const [institutionId] = await insertMany(
    "institutions",
    ["name", "code", "type"],
    [[`Perf School ${index}`, code, "school"]]
  );

  // Admin for the perf login.
  await insertMany(
    "users",
    ["email", "password_hash", "full_name", "role", "institution_id"],
    [[`perfadmin${index}@sreedo.edu`, passwordHash, `Perf Admin ${index}`, "admin", institutionId]],
    "id"
  );

  // Classes → sections. classes.name is globally unique, so prefix with the code.
  const classRows = Array.from({ length: CLASSES }, (_, c) => [
    institutionId,
    `${code} Grade ${c + 1}`,
    c + 1,
  ]);
  const classIds = await insertMany("classes", ["institution_id", "name", "grade_level"], classRows);

  const sectionRows: unknown[][] = [];
  for (const classId of classIds) {
    for (let s = 0; s < SECTIONS_PER_CLASS; s += 1) {
      sectionRows.push([institutionId, classId, String.fromCharCode(65 + s)]);
    }
  }
  const sectionIds = await insertMany(
    "sections",
    ["institution_id", "class_id", "name"],
    sectionRows
  );

  // Teachers.
  const today = dateBack(0);
  const teacherRows = Array.from({ length: TEACHERS }, (_, t) => [
    institutionId,
    `${code}-EMP-${String(t + 1).padStart(4, "0")}`,
    `Teacher${t + 1}`,
    `Perf${index}`,
    `perf${index}.t${t + 1}@sreedo.edu`,
    "General",
    today,
  ]);
  await insertMany(
    "teachers",
    ["institution_id", "employee_no", "first_name", "last_name", "email", "specialization", "joining_date"],
    teacherRows
  );

  // Subjects (for homework).
  const subjectRows = Array.from({ length: SUBJECTS }, (_, s) => [
    institutionId,
    `Subject ${s + 1}`,
    `${code}-S${s + 1}`,
  ]);
  const subjectIds = await insertMany("subjects", ["institution_id", "name", "code"], subjectRows);

  // Students (round-robin across sections).
  const studentRows = Array.from({ length: STUDENTS }, (_, n) => [
    institutionId,
    `${code}-ADM-${String(n + 1).padStart(5, "0")}`,
    `Student${n + 1}`,
    `Perf${index}`,
    n % 2 === 0 ? "male" : "female",
    sectionIds[n % sectionIds.length],
    `Guardian ${n + 1}`,
    `+91-90000-${String(n % 100000).padStart(5, "0")}`,
  ]);
  const studentIds = await insertMany(
    "students",
    ["institution_id", "admission_no", "first_name", "last_name", "gender", "section_id", "guardian_name", "guardian_phone"],
    studentRows
  );

  // Attendance for the last N days (mostly present).
  const attendanceRows: unknown[][] = [];
  for (let d = 0; d < ATTENDANCE_DAYS; d += 1) {
    const date = dateBack(d);
    studentIds.forEach((sid, i) => {
      const status = i % 17 === 0 ? "absent" : i % 23 === 0 ? "late" : "present";
      attendanceRows.push([sid, date, status, institutionId]);
    });
  }
  await insertMany(
    "attendance_records",
    ["student_id", "date", "status", "institution_id"],
    attendanceRows,
    "id"
  );

  // One invoice per student; a payment on roughly half (mix of dues + collections).
  const dueDate = `${new Date().getFullYear() + 1}-03-31`;
  const invoiceRows = studentIds.map((sid, n) => [
    `${code}-INV-${String(n + 1).padStart(5, "0")}`,
    sid,
    "Term 1 Tuition",
    15000,
    dueDate,
    "pending",
    institutionId,
  ]);
  const invoiceIds = await insertMany(
    "invoices",
    ["invoice_no", "student_id", "description", "amount_due", "due_date", "status", "institution_id"],
    invoiceRows
  );
  const paymentRows = invoiceIds
    .filter((_, n) => n % 2 === 0)
    .map((invoiceId) => [invoiceId, 5000, "cash", institutionId]);
  if (paymentRows.length > 0) {
    await insertMany("payments", ["invoice_id", "amount", "method", "institution_id"], paymentRows, "id");
  }

  // A couple of homework items per section.
  const homeworkRows: unknown[][] = [];
  sectionIds.forEach((sid, i) => {
    for (let h = 0; h < 2; h += 1) {
      homeworkRows.push([institutionId, sid, subjectIds[(i + h) % subjectIds.length], `Homework ${h + 1}`]);
    }
  });
  await insertMany("homework", ["institution_id", "section_id", "subject_id", "title"], homeworkRows, "id");

  console.log(
    `  ${code}: ${STUDENTS} students, ${TEACHERS} teachers, ${sectionIds.length} sections, ` +
      `${attendanceRows.length} attendance, ${invoiceIds.length} invoices`
  );
}

async function main(): Promise<void> {
  await runMigrations();
  console.log(`Seeding performance data: ${INSTITUTIONS} institutions…`);
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  // Shared super admin for the super-admin scenarios (idempotent).
  await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Perf Super Admin', 'super_admin')
     ON CONFLICT (email) DO NOTHING`,
    [SUPER_EMAIL, passwordHash]
  );

  for (let i = 1; i <= INSTITUTIONS; i += 1) {
    await seedInstitution(i, passwordHash);
  }

  console.log(
    `\nDone. Run the suite with, e.g.:\n` +
      `  PERF_STAFF_EMAIL=perfadmin1@sreedo.edu PERF_STAFF_PASSWORD=${ADMIN_PASSWORD} \\\n` +
      `  PERF_SUPER_EMAIL=${SUPER_EMAIL} PERF_SUPER_PASSWORD=${ADMIN_PASSWORD} npm run perf`
  );
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
