import request from "supertest";
import { createApp } from "../../src/app";
import { query } from "../../src/db/postgres";
import { hashPassword } from "../../src/utils/password";
import type { UserRole } from "../../src/types";

export { query };

/** Shared app instance for the test file (created at NODE_ENV=test). */
export const app = createApp();

const TABLES = [
  "refresh_tokens",
  "payments",
  "invoices",
  "fee_structures",
  "exam_results",
  "exams",
  "attendance_records",
  "class_subjects",
  "students",
  "sections",
  "classes",
  "subjects",
  "teachers",
  "academic_years",
  "announcements",
  "users",
];

/** Empties all domain tables and resets the numbering sequences. */
export async function resetDb(): Promise<void> {
  await query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await query("ALTER SEQUENCE student_admission_seq RESTART WITH 1");
  await query("ALTER SEQUENCE teacher_employee_seq RESTART WITH 1");
}

/** Inserts a user directly (bypassing the admin-only API) for test setup. */
export async function createUser(opts: {
  email: string;
  password: string;
  role: UserRole;
  fullName?: string;
}): Promise<{ id: string }> {
  const passwordHash = await hashPassword(opts.password);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.email, passwordHash, opts.fullName ?? "Test User", opts.role]
  );
  return rows[0];
}

/** Logs in and returns the access token, throwing on failure. */
export async function tokenFor(
  email: string,
  password: string
): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}
