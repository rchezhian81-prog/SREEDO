import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, resetDb, tokenFor } from "./helpers";

const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const year = new Date().getFullYear();

describe("sequence-based numbering", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...ADMIN, role: "admin" });
    token = await tokenFor(ADMIN.email, ADMIN.password);
  });

  it("assigns admission numbers from a sequence", async () => {
    const numbers: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const res = await request(app)
        .post("/api/v1/students")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: name, lastName: "Student" });
      expect(res.status).toBe(201);
      numbers.push(res.body.admissionNo);
    }
    expect(numbers).toEqual([
      `ADM-${year}-0001`,
      `ADM-${year}-0002`,
      `ADM-${year}-0003`,
    ]);
  });

  it("assigns employee numbers from a sequence", async () => {
    const numbers: string[] = [];
    for (const name of ["A", "B"]) {
      const res = await request(app)
        .post("/api/v1/teachers")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: name, lastName: "Teacher" });
      expect(res.status).toBe(201);
      numbers.push(res.body.employeeNo);
    }
    expect(numbers).toEqual(["EMP-0001", "EMP-0002"]);
  });
});
