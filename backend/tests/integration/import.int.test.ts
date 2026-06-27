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

const ADMIN = { email: "admin@imp.dev", password: "Passw0rd!" };

describe("bulk import (students & staff)", () => {
  let token: string;
  let institutionId: string;

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution();
    await createUser({
      ...ADMIN,
      role: "admin",
      fullName: "Admin",
      institutionId,
    });
    token = await tokenFor(ADMIN.email, ADMIN.password);
  });

  it("imports students atomically and auto-generates admission numbers", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set("Authorization", `Bearer ${token}`)
      .send({
        rows: [
          { firstName: "Asha", lastName: "Rao" },
          { firstName: "Vik", lastName: "Sharma", guardianEmail: "p@x.com" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    const { rows } = await query(
      "SELECT admission_no FROM students WHERE institution_id = $1",
      [institutionId]
    );
    expect(rows.length).toBe(2);
    expect(rows.every((r) => /^ADM-/.test(r.admission_no))).toBe(true);
  });

  it("rejects an invalid student row (400, nothing imported)", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ rows: [{ firstName: "OnlyFirst" }] });
    expect(res.status).toBe(400);
    const { rows } = await query("SELECT * FROM students");
    expect(rows.length).toBe(0);
  });

  it("requires admin for student import (403 for a teacher)", async () => {
    await createUser({
      email: "t@imp.dev",
      password: "Passw0rd!",
      role: "teacher",
      institutionId,
    });
    const teacherToken = await tokenFor("t@imp.dev", "Passw0rd!");
    const res = await request(app)
      .post("/api/v1/students/import")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ rows: [{ firstName: "A", lastName: "B" }] });
    expect(res.status).toBe(403);
  });

  it("imports teachers and auto-generates employee numbers", async () => {
    const res = await request(app)
      .post("/api/v1/teachers/import")
      .set("Authorization", `Bearer ${token}`)
      .send({
        rows: [
          { firstName: "Meena", lastName: "Iyer", email: "m@x.com" },
          { firstName: "Raj", lastName: "Kumar" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    const { rows } = await query(
      "SELECT employee_no FROM teachers WHERE institution_id = $1",
      [institutionId]
    );
    expect(rows.length).toBe(2);
    expect(rows.every((r) => /^EMP-/.test(r.employee_no))).toBe(true);
  });

  it("rejects an invalid teacher row (400)", async () => {
    const res = await request(app)
      .post("/api/v1/teachers/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ rows: [{ lastName: "NoFirst" }] });
    expect(res.status).toBe(400);
  });

  it("rejects an empty import (400)", async () => {
    const res = await request(app)
      .post("/api/v1/students/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ rows: [] });
    expect(res.status).toBe(400);
  });
});
