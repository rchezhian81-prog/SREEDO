import { pool, query } from "./postgres";
import { runMigrations } from "./migrate";
import { hashPassword } from "../utils/password";

const ADMIN_EMAIL = "admin@sreedo.edu";
const ADMIN_PASSWORD = "Admin@12345";
const SUPER_ADMIN_EMAIL = "super@sreedo.edu";
const SUPER_ADMIN_PASSWORD = "Super@12345";

/** Seeds demo data only when the database has no users yet (idempotent). */
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await query<{ count: string }>("SELECT count(*) FROM users");
  if (Number(rows[0].count) > 0) {
    console.log("Seed skipped — users already exist");
    return;
  }
  await seed();
}

export async function seed(): Promise<void> {
  console.log("Seeding demo data…");

  const adminHash = await hashPassword(ADMIN_PASSWORD);
  await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'School Administrator', 'admin')`,
    [ADMIN_EMAIL, adminHash]
  );

  // Super admin + a demo tenant (institution, branch, package, subscription).
  const superHash = await hashPassword(SUPER_ADMIN_PASSWORD);
  await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Platform Super Admin', 'super_admin')`,
    [SUPER_ADMIN_EMAIL, superHash]
  );
  const { rows: instRows } = await query<{ id: string }>(
    `INSERT INTO institutions (name, code, type)
     VALUES ('SRE Demo School', 'SREDEMO', 'school') RETURNING id`
  );
  const institutionId = instRows[0].id;
  await query(
    `INSERT INTO branches (institution_id, name, address)
     VALUES ($1, 'Main Campus', '1 School Road')`,
    [institutionId]
  );
  const { rows: pkgRows } = await query<{ id: string }>(
    `INSERT INTO subscription_packages (name, max_students, max_staff, price, billing_cycle)
     VALUES ('Standard', 1000, 200, 50000, 'annual') RETURNING id`
  );
  await query(
    `INSERT INTO institution_subscriptions (institution_id, package_id, status)
     VALUES ($1, $2, 'active')`,
    [institutionId, pkgRows[0].id]
  );

  const year = new Date().getFullYear();
  const { rows: yearRows } = await query<{ id: string }>(
    `INSERT INTO academic_years (institution_id, name, start_date, end_date, is_current)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [institutionId, `${year}-${year + 1}`, `${year}-06-01`, `${year + 1}-04-30`]
  );
  const academicYearId = yearRows[0].id;

  const teacherSeed = [
    ["EMP-0001", "Asha", "Krishnan", "asha.krishnan@sreedo.edu", "Mathematics"],
    ["EMP-0002", "Ravi", "Sharma", "ravi.sharma@sreedo.edu", "Science"],
  ];
  const teacherIds: string[] = [];
  for (const [no, first, last, email, specialization] of teacherSeed) {
    const { rows: teacherRows } = await query<{ id: string }>(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name, email, specialization, joining_date)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING id`,
      [institutionId, no, first, last, email, specialization]
    );
    teacherIds.push(teacherRows[0].id);
  }

  const sectionIds: string[] = [];
  for (const grade of [1, 2]) {
    const { rows: classRows } = await query<{ id: string }>(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, $2, $3) RETURNING id`,
      [institutionId, `Grade ${grade}`, grade]
    );
    for (const sectionName of ["A", "B"]) {
      const { rows: sectionRows } = await query<{ id: string }>(
        `INSERT INTO sections (institution_id, class_id, name, homeroom_teacher_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [institutionId, classRows[0].id, sectionName, teacherIds[grade - 1]]
      );
      sectionIds.push(sectionRows[0].id);
    }
  }

  for (const [name, code] of [
    ["Mathematics", "MATH"],
    ["English", "ENG"],
    ["Science", "SCI"],
    ["Social Studies", "SOC"],
  ]) {
    await query(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, $2, $3)`,
      [institutionId, name, code]
    );
  }

  const studentSeed: Array<[string, string, string, string]> = [
    ["Aarav", "Patel", "male", "Meera Patel"],
    ["Diya", "Nair", "female", "Suresh Nair"],
    ["Ishaan", "Reddy", "male", "Lakshmi Reddy"],
    ["Ananya", "Iyer", "female", "Raghav Iyer"],
    ["Vihaan", "Das", "male", "Priya Das"],
    ["Sara", "Khan", "female", "Imran Khan"],
  ];
  let admission = 1;
  for (const [first, last, gender, guardian] of studentSeed) {
    await query(
      `INSERT INTO students (
         institution_id, admission_no, first_name, last_name, gender, section_id,
         guardian_name, guardian_phone
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        institutionId,
        `ADM-${year}-${String(admission).padStart(4, "0")}`,
        first,
        last,
        gender,
        sectionIds[(admission - 1) % sectionIds.length],
        guardian,
        `+91-90000-000${String(admission).padStart(2, "0")}`,
      ]
    );
    admission += 1;
  }

  await query(
    `INSERT INTO fee_structures (institution_id, name, academic_year_id, amount, frequency)
     VALUES ($1, 'Term 1 Tuition', $2, 15000, 'term')`,
    [institutionId, academicYearId]
  );

  await query(
    `INSERT INTO announcements (institution_id, title, body, audience, is_pinned, created_by)
     VALUES (
       $1,
       'Welcome to SRE EDU OS',
       'The school ERP is now live. Staff can sign in to manage students, attendance, exams and fees.',
       'all',
       true,
       (SELECT id FROM users WHERE email = $2)
     )`,
    [institutionId, ADMIN_EMAIL]
  );

  // Tag all seeded school data with the demo institution (multi-tenancy).
  const tenantTables = [
    "students",
    "teachers",
    "academic_years",
    "classes",
    "sections",
    "subjects",
    "class_subjects",
    "attendance_records",
    "fee_structures",
    "invoices",
    "payments",
    "exams",
    "exam_results",
    "announcements",
  ];
  for (const table of tenantTables) {
    await query(
      `UPDATE ${table} SET institution_id = $1 WHERE institution_id IS NULL`,
      [institutionId]
    );
  }
  await query(
    `UPDATE users SET institution_id = $1 WHERE institution_id IS NULL AND role <> 'super_admin'`,
    [institutionId]
  );

  // Re-sync the numbering sequences past the literal numbers seeded above so
  // records created later through the API never collide with them.
  await query(
    `SELECT setval('student_admission_seq',
       (SELECT COALESCE(MAX(CAST(SUBSTRING(admission_no FROM '[0-9]+$') AS INTEGER)), 0)
        FROM students), true)`
  );
  await query(
    `SELECT setval('teacher_employee_seq',
       (SELECT COALESCE(MAX(CAST(SUBSTRING(employee_no FROM '[0-9]+$') AS INTEGER)), 0)
        FROM teachers), true)`
  );

  console.log(
    `Seed complete — admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} · ` +
      `super admin: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`
  );
}

if (require.main === module) {
  runMigrations()
    .then(() => seedIfEmpty())
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
