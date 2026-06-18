import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const USERS = {
  admin: { email: "admin@test.dev", password: "Passw0rd!" },
  teacher: { email: "teacher@test.dev", password: "Passw0rd!" },
  accountant: { email: "accountant@test.dev", password: "Passw0rd!" },
  student: { email: "student@test.dev", password: "Passw0rd!" },
} as const;

describe("role-protected access & owner-scoping", () => {
  const tokens: Record<string, string> = {};
  let studentUserId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...USERS.admin, role: "admin" });
    await createUser({ ...USERS.teacher, role: "teacher" });
    await createUser({ ...USERS.accountant, role: "accountant" });
    const studentUser = await createUser({ ...USERS.student, role: "student" });
    studentUserId = studentUser.id;
    for (const [key, creds] of Object.entries(USERS)) {
      tokens[key] = await tokenFor(creds.email, creds.password);
    }
  });

  it("allows only admins to create students", async () => {
    const asTeacher = await request(app)
      .post("/api/v1/students")
      .set("Authorization", `Bearer ${tokens.teacher}`)
      .send({ firstName: "X", lastName: "Y" });
    expect(asTeacher.status).toBe(403);

    const asAdmin = await request(app)
      .post("/api/v1/students")
      .set("Authorization", `Bearer ${tokens.admin}`)
      .send({ firstName: "X", lastName: "Y" });
    expect(asAdmin.status).toBe(201);
  });

  it("lets accountants create fee structures but not teachers", async () => {
    const asTeacher = await request(app)
      .post("/api/v1/fees/structures")
      .set("Authorization", `Bearer ${tokens.teacher}`)
      .send({ name: "Term 1", amount: 1000 });
    expect(asTeacher.status).toBe(403);

    const asAccountant = await request(app)
      .post("/api/v1/fees/structures")
      .set("Authorization", `Bearer ${tokens.accountant}`)
      .send({ name: "Term 1", amount: 1000 });
    expect(asAccountant.status).toBe(201);
  });

  it("scopes a student's reads to their own record", async () => {
    // One student linked to the student user, and one unrelated student.
    await query(
      `INSERT INTO students (user_id, admission_no, first_name, last_name)
       VALUES ($1, 'ADM-OWN-1', 'Own', 'Student')`,
      [studentUserId]
    );
    await query(
      `INSERT INTO students (admission_no, first_name, last_name)
       VALUES ('ADM-OTHER-1', 'Other', 'Student')`
    );

    const asStudent = await request(app)
      .get("/api/v1/students")
      .set("Authorization", `Bearer ${tokens.student}`);
    expect(asStudent.status).toBe(200);
    expect(asStudent.body.data).toHaveLength(1);
    expect(asStudent.body.data[0].admissionNo).toBe("ADM-OWN-1");

    const asAdmin = await request(app)
      .get("/api/v1/students")
      .set("Authorization", `Bearer ${tokens.admin}`);
    expect(asAdmin.body.data).toHaveLength(2);
  });
});
