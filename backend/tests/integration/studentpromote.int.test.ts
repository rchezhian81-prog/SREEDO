import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (p: string, t: string, b: unknown) =>
  request(app).post(p).set(auth(t)).send(b);
const get = (p: string, t: string) => request(app).get(p).set(auth(t));

describe("student promotion", () => {
  describe("school", () => {
    let tok: string;
    let secA: string;
    let secB: string;
    let s1: string;
    let s2: string;

    beforeEach(async () => {
      await resetDb();
      const inst = await createInstitution("PROM", "school");
      await createUser({ email: "admin@prom.dev", password: PW, role: "admin", institutionId: inst });
      tok = await tokenFor("admin@prom.dev", PW);
      const cls = await post("/api/v1/classes", tok, { name: "Grade 5", gradeLevel: 5 });
      secA = (await post(`/api/v1/classes/${cls.body.id}/sections`, tok, { name: "A" })).body.id;
      secB = (await post(`/api/v1/classes/${cls.body.id}/sections`, tok, { name: "B" })).body.id;
      s1 = (await post("/api/v1/students", tok, { firstName: "Asha", lastName: "Rao", sectionId: secA })).body.id;
      s2 = (await post("/api/v1/students", tok, { firstName: "Bala", lastName: "Iyer", sectionId: secA })).body.id;
    });

    it("moves students to the target section", async () => {
      const r = await post("/api/v1/students/promote", tok, {
        studentIds: [s1, s2],
        toSectionId: secB,
      });
      expect(r.status).toBe(200);
      expect(r.body.promoted).toBe(2);
      const inB = await get(`/api/v1/students?sectionId=${secB}`, tok);
      expect(inB.body.meta.total).toBe(2);
    });

    it("graduates students", async () => {
      const r = await post("/api/v1/students/promote", tok, {
        studentIds: [s1],
        graduate: true,
      });
      expect(r.status).toBe(200);
      expect(r.body.graduated).toBe(1);
      const grad = await get("/api/v1/students?status=graduated", tok);
      expect(grad.body.meta.total).toBe(1);
    });

    it("rejects no target and an unknown section", async () => {
      expect((await post("/api/v1/students/promote", tok, { studentIds: [s1] })).status).toBe(400);
      expect(
        (
          await post("/api/v1/students/promote", tok, {
            studentIds: [s1],
            toSectionId: "00000000-0000-0000-0000-000000000000",
          })
        ).status
      ).toBe(400);
    });
  });

  describe("college", () => {
    let tok: string;
    let sem2: string;
    let st: string;

    beforeEach(async () => {
      await resetDb();
      const inst = await createInstitution("PROMC", "college");
      await createUser({ email: "admin@promc.dev", password: PW, role: "admin", institutionId: inst });
      tok = await tokenFor("admin@promc.dev", PW);
      const dept = await post("/api/v1/college/departments", tok, { name: "CS", code: "CS" });
      const prog = await post("/api/v1/college/programs", tok, {
        name: "BSc CS",
        code: "BSCCS",
        departmentId: dept.body.id,
      });
      const sem1 = (await post("/api/v1/college/semesters", tok, { programId: prog.body.id, name: "Sem 1", number: 1 })).body.id;
      sem2 = (await post("/api/v1/college/semesters", tok, { programId: prog.body.id, name: "Sem 2", number: 2 })).body.id;
      st = (await post("/api/v1/students", tok, { firstName: "Chetan", lastName: "M" })).body.id;
      await post("/api/v1/college/enrollments", tok, { studentId: st, programId: prog.body.id, semesterId: sem1 });
    });

    it("advances enrollments to the next semester", async () => {
      const r = await post("/api/v1/students/promote", tok, {
        studentIds: [st],
        toSemesterId: sem2,
      });
      expect(r.status).toBe(200);
      expect(r.body.promoted).toBe(1);
      const enr = await get(`/api/v1/college/enrollments?semesterId=${sem2}`, tok);
      expect(enr.body).toHaveLength(1);
    });
  });
});
