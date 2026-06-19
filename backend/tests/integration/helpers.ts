import request from "supertest";
import { createApp } from "../../src/app";
import { query } from "../../src/db/postgres";
import { hashPassword } from "../../src/utils/password";
import type { UserRole } from "../../src/types";

export { query };

/** Shared app instance for the test file (created at NODE_ENV=test). */
export const app = createApp();

const TABLES = [
  "invoice_discounts",
  "invoice_fines",
  "fee_discounts",
  "fee_fine_rules",
  "fee_schedules",
  "fee_categories",
  "payment_webhook_events",
  "payment_orders",
  "data_exports",
  "payslip_lines",
  "payslips",
  "payroll_runs",
  "salary_structure_components",
  "salary_structures",
  "salary_components",
  "staff_attendance",
  "leave_requests",
  "leave_balances",
  "leave_types",
  "stock_movements",
  "stock_adjustments",
  "stock_issues",
  "purchase_items",
  "purchases",
  "inventory_items",
  "vendors",
  "item_categories",
  "hostel_invoices",
  "hostel_allocations",
  "hostel_fees",
  "hostel_rooms",
  "hostel_blocks",
  "hostels",
  "transport_invoices",
  "transport_trips",
  "transport_fees",
  "student_transport",
  "route_stops",
  "transport_routes",
  "vehicles",
  "drivers",
  "book_issues",
  "book_copies",
  "books",
  "book_categories",
  "library_members",
  "library_settings",
  "homework_submissions",
  "homework",
  "documents",
  "notification_log",
  "message_recipients",
  "messages",
  "device_tokens",
  "grade_bands",
  "guardians",
  "staff_allocations",
  "enrollments",
  "program_subjects",
  "batches",
  "semesters",
  "programs",
  "departments",
  "timetable_entries",
  "periods",
  "rooms",
  "institution_subscriptions",
  "branches",
  "subscription_packages",
  "institutions",
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
  institutionId?: string | null;
}): Promise<{ id: string }> {
  const passwordHash = await hashPassword(opts.password);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, institution_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.email,
      passwordHash,
      opts.fullName ?? "Test User",
      opts.role,
      opts.institutionId ?? null,
    ]
  );
  return rows[0];
}

/** Creates an institution directly and returns its id (test setup). */
export async function createInstitution(
  code = "TEST",
  type: "school" | "college" = "school"
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO institutions (name, code, type)
     VALUES ($1, $2, $3) RETURNING id`,
    [`Institution ${code}`, code, type]
  );
  return rows[0].id;
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
