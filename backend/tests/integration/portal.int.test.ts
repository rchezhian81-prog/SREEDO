import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("parent/student portal", () => {
  let instA: string;
  let instB: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let sB: string;

  /** Logs in via the portal (cookie flow) and returns a cookie-persisting agent. */
  async function portalLogin(email: string) {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/v1/auth/portal/login")
      .send({ email, password: PW });
    return { agent, res };
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PA");
    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1) RETURNING id`,
      [instA]
    );
    const sectionA = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instA, classId]
    );
    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'A1', 'Aarav', 'Patel', $2) RETURNING id`,
      [instA, sectionA]
    );
    s2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'A2', 'Diya', 'Nair', $2) RETURNING id`,
      [instA, sectionA]
    );
    s3 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'A3', 'Un', 'Related') RETURNING id`,
      [instA]
    );

    // Student login linked to s1.
    const studentUser = await createUser({
      email: "student@p.dev",
      password: PW,
      role: "student",
      institutionId: instA,
    });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [
      studentUser.id,
      s1,
    ]);

    // Parent linked to s1 + s2 (not s3).
    const parentUser = await createUser({
      email: "parent@p.dev",
      password: PW,
      role: "parent",
      institutionId: instA,
    });
    for (const sid of [s1, s2]) {
      await query(
        `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1, $2, $3, 'guardian')`,
        [instA, parentUser.id, sid]
      );
    }

    // Data for s1: attendance, an invoice, and a timetable entry on section A.
    await query(
      `INSERT INTO attendance_records (institution_id, student_id, date, status) VALUES ($1, $2, CURRENT_DATE, 'present')`,
      [instA, s1]
    );
    await query(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date) VALUES ($1, 'INV-P1', $2, 'Tuition', 1000, '2026-12-31')`,
      [instA, s1]
    );
    const subj = await insertId(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH') RETURNING id`,
      [instA]
    );
    const period = await insertId(
      `INSERT INTO periods (institution_id, name, start_time, end_time, sort_order) VALUES ($1, 'P1', '08:00', '08:45', 1) RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO timetable_entries (institution_id, section_id, day_of_week, period_id, subject_id) VALUES ($1, $2, 1, $3, $4)`,
      [instA, sectionA, period, subj]
    );

    // A second institution with its own student (cross-tenant target).
    instB = await createInstitution("PB");
    const classB = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'GB', 1) RETURNING id`,
      [instB]
    );
    const sectionB = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1, $2, 'A') RETURNING id`,
      [instB, classB]
    );
    sB = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id) VALUES ($1, 'B1', 'Bee', 'Boy', $2) RETURNING id`,
      [instB, sectionB]
    );
  });

  it("issues httpOnly cookies on portal login and rejects staff", async () => {
    const { res } = await portalLogin("student@p.dev");
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("student");
    expect(res.body.accessToken).toBeUndefined(); // tokens are cookies, not body
    const cookies = (res.headers["set-cookie"] ?? []) as unknown as string[];
    const joined = cookies.join(";");
    expect(joined).toMatch(/access_token=/);
    expect(joined).toMatch(/refresh_token=/);
    expect(joined).toMatch(/HttpOnly/i);

    await createUser({
      email: "admin@p.dev",
      password: PW,
      role: "admin",
      institutionId: instA,
    });
    const staff = await request(app)
      .post("/api/v1/auth/portal/login")
      .send({ email: "admin@p.dev", password: PW });
    expect(staff.status).toBe(403);
  });

  it("authenticates via cookie (no Bearer) and logout clears the session", async () => {
    const { agent } = await portalLogin("student@p.dev");
    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("student");

    const out = await agent.post("/api/v1/auth/portal/logout");
    expect(out.status).toBe(204);
    const after = await agent.get("/api/v1/auth/me");
    expect(after.status).toBe(401);
  });

  it("rotates the session from the refresh cookie", async () => {
    const { agent } = await portalLogin("student@p.dev");
    const refreshed = await agent.post("/api/v1/auth/portal/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe("student");
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("scopes a student to only their own data", async () => {
    const { agent } = await portalLogin("student@p.dev");
    const children = await agent.get("/api/v1/portal/children");
    expect(children.status).toBe(200);
    expect(children.body).toHaveLength(1);
    expect(children.body[0].id).toBe(s1);

    expect((await agent.get(`/api/v1/portal/students/${s1}/summary`)).status).toBe(200);
    expect((await agent.get(`/api/v1/portal/students/${s2}/summary`)).status).toBe(403);
    expect((await agent.get(`/api/v1/portal/students/${s3}/summary`)).status).toBe(403);
  });

  it("scopes a parent to only their linked children", async () => {
    const { agent } = await portalLogin("parent@p.dev");
    const children = await agent.get("/api/v1/portal/children");
    expect(children.status).toBe(200);
    expect(children.body).toHaveLength(2);
    const ids = (children.body as Array<{ id: string }>).map((c) => c.id).sort();
    expect(ids).toEqual([s1, s2].sort());

    expect((await agent.get(`/api/v1/portal/students/${s1}/summary`)).status).toBe(200);
    expect((await agent.get(`/api/v1/portal/students/${s3}/summary`)).status).toBe(403);
  });

  it("denies cross-institution access", async () => {
    const { agent } = await portalLogin("parent@p.dev");
    const cross = await agent.get(`/api/v1/portal/students/${sB}/summary`);
    expect(cross.status).toBe(403);
  });

  it("returns attendance, fee and timetable portal views", async () => {
    const { agent } = await portalLogin("student@p.dev");
    const summary = await agent.get(`/api/v1/portal/students/${s1}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.profile.id).toBe(s1);
    expect(summary.body.attendance.total).toBe(1);
    expect(summary.body.attendance.present).toBe(1);
    expect(summary.body.fees.totalDue).toBe(1000);
    expect(summary.body.fees.outstanding).toBe(1000);

    const tt = await agent.get(`/api/v1/portal/students/${s1}/timetable`);
    expect(tt.status).toBe(200);
    expect(tt.body).toHaveLength(1);
    expect(tt.body[0].subjectName).toBe("Math");
  });

  it("blocks unauthenticated portal access", async () => {
    const res = await request(app).get("/api/v1/portal/children");
    expect(res.status).toBe(401);
    // staff Bearer tokens are rejected by the portal's role guard too
    await createUser({
      email: "admin2@p.dev",
      password: PW,
      role: "admin",
      institutionId: instA,
    });
    const staffToken = await tokenFor("admin2@p.dev", PW);
    const staff = await request(app)
      .get("/api/v1/portal/children")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staff.status).toBe(403);
  });
});
