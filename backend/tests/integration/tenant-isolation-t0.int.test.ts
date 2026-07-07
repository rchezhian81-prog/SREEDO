import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

// Tenant Hardening T0 — proves the multi-tenancy correctness fixes:
//  (1) the daily-attendance cross-tenant OVERWRITE is blocked,
//  (2) the pre-tenancy global UNIQUE namespaces are re-scoped per-tenant,
//  (3) admission/employee numbering is per-tenant,
//  (4) in-tenant FK validation rejects foreign student/section/subject refs.
describe("Tenant Hardening T0 — isolation & multi-tenancy correctness", () => {
  const tok: Record<string, string> = {};
  const PW = "Passw0rd!";
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (p: string, t: string, b?: unknown) =>
    request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b?: unknown) =>
    request(app).patch(p).set(auth(t)).send(b ?? {});
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));

  beforeEach(async () => {
    await resetDb();
    const instA = await createInstitution("AAA");
    const instB = await createInstitution("BBB");
    await createUser({ email: "a@t0.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "b@t0.dev", password: PW, role: "admin", institutionId: instB });
    tok.a = await tokenFor("a@t0.dev", PW);
    tok.b = await tokenFor("b@t0.dev", PW);
  });

  // ---- (2) re-scoped global UNIQUE namespaces --------------------------------

  it("lets two institutions use the SAME academic-year name / class name / subject code", async () => {
    for (const t of [tok.a, tok.b]) {
      expect(
        (await post("/api/v1/academic-years", t, { name: "2025-2026", startDate: "2025-06-01", endDate: "2026-05-31" })).status
      ).toBe(201);
      expect((await post("/api/v1/classes", t, { name: "Grade 1", gradeLevel: 1 })).status).toBe(201);
      expect((await post("/api/v1/subjects", t, { name: "Mathematics", code: "MATH101" })).status).toBe(201);
    }
  });

  it("lets two institutions use the SAME explicit admission number", async () => {
    expect((await post("/api/v1/students", tok.a, { firstName: "A", lastName: "1", admissionNo: "ADM-SHARED" })).status).toBe(201);
    // Before the re-scope this collided on the global UNIQUE(admission_no); now it is per-tenant.
    expect((await post("/api/v1/students", tok.b, { firstName: "B", lastName: "1", admissionNo: "ADM-SHARED" })).status).toBe(201);
  });

  // ---- (3) per-tenant numbering ----------------------------------------------

  it("auto-numbers admissions per-tenant (both tenants start at ADM-<year>-0001)", async () => {
    const year = new Date().getFullYear();
    const a1 = await post("/api/v1/students", tok.a, { firstName: "A", lastName: "One" });
    const b1 = await post("/api/v1/students", tok.b, { firstName: "B", lastName: "One" });
    expect(a1.status).toBe(201);
    expect(b1.status).toBe(201);
    expect(a1.body.admissionNo).toBe(`ADM-${year}-0001`);
    expect(b1.body.admissionNo).toBe(`ADM-${year}-0001`); // per-tenant, not a shared global counter
    // A's counter continues independently of B's.
    const a2 = await post("/api/v1/students", tok.a, { firstName: "A", lastName: "Two" });
    expect(a2.body.admissionNo).toBe(`ADM-${year}-0002`);
  });

  it("auto-numbers employees per-tenant (both tenants start at EMP-0001)", async () => {
    const a = await post("/api/v1/teachers", tok.a, { firstName: "TA", lastName: "One" });
    const b = await post("/api/v1/teachers", tok.b, { firstName: "TB", lastName: "One" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.employeeNo).toBe("EMP-0001");
    expect(b.body.employeeNo).toBe("EMP-0001");
  });

  // ---- (1) attendance cross-tenant WRITE (the HIGH bug) ----------------------

  it("BLOCKS marking attendance for another institution's student, leaving it untouched", async () => {
    const bStudent = (await post("/api/v1/students", tok.b, { firstName: "Bob", lastName: "B" })).body;
    // B marks Bob present.
    expect(
      (await post("/api/v1/attendance", tok.b, { date: "2026-02-02", records: [{ studentId: bStudent.id, status: "present" }] })).status
    ).toBe(200);
    // A tries to OVERWRITE Bob's row by supplying B's student UUID → rejected.
    const attack = await post("/api/v1/attendance", tok.a, {
      date: "2026-02-02",
      records: [{ studentId: bStudent.id, status: "absent" }],
    });
    expect(attack.status).toBe(400);
    // Bob's attendance is still 'present' (not overwritten to 'absent').
    const hist = await get(`/api/v1/attendance/students/${bStudent.id}`, tok.b);
    expect(hist.status).toBe(200);
    expect(hist.body.records[0].status).toBe("present");
  });

  it("still lets an admin mark attendance for their OWN student", async () => {
    const aStudent = (await post("/api/v1/students", tok.a, { firstName: "Al", lastName: "A" })).body;
    expect(
      (await post("/api/v1/attendance", tok.a, { date: "2026-02-03", records: [{ studentId: aStudent.id, status: "present" }] })).status
    ).toBe(200);
  });

  // ---- (4) in-tenant FK validation -------------------------------------------

  async function bSection(): Promise<string> {
    const cls = (await post("/api/v1/classes", tok.b, { name: "BClass", gradeLevel: 3 })).body;
    return (await post(`/api/v1/classes/${cls.id}/sections`, tok.b, { name: "B1" })).body.id;
  }

  it("rejects creating a student in a FOREIGN section", async () => {
    const sec = await bSection();
    expect((await post("/api/v1/students", tok.a, { firstName: "X", lastName: "Y", sectionId: sec })).status).toBe(400);
  });

  it("rejects UPDATING a student into a foreign section", async () => {
    const aStudent = (await post("/api/v1/students", tok.a, { firstName: "Al", lastName: "A" })).body;
    const sec = await bSection();
    expect((await patch(`/api/v1/students/${aStudent.id}`, tok.a, { sectionId: sec })).status).toBe(400);
  });

  it("rejects invoicing a FOREIGN student", async () => {
    const bStudent = (await post("/api/v1/students", tok.b, { firstName: "Bob", lastName: "B" })).body;
    expect(
      (await post("/api/v1/fees/invoices", tok.a, { studentId: bStudent.id, description: "x", amountDue: 100, dueDate: "2026-12-31" })).status
    ).toBe(400);
  });

  it("rejects exam results for a foreign student or subject (and allows own)", async () => {
    const exam = (await post("/api/v1/exams", tok.a, { name: "Midterm" })).body;
    const aSubject = (await post("/api/v1/subjects", tok.a, { name: "Science", code: "SCI1" })).body;
    const aStudent = (await post("/api/v1/students", tok.a, { firstName: "Al", lastName: "A" })).body;
    // own student + own subject → 200
    expect(
      (await post(`/api/v1/exams/${exam.id}/results`, tok.a, { results: [{ studentId: aStudent.id, subjectId: aSubject.id, marksObtained: 80 }] })).status
    ).toBe(200);
    // foreign student → 400
    const bStudent = (await post("/api/v1/students", tok.b, { firstName: "Bob", lastName: "B" })).body;
    expect(
      (await post(`/api/v1/exams/${exam.id}/results`, tok.a, { results: [{ studentId: bStudent.id, subjectId: aSubject.id, marksObtained: 80 }] })).status
    ).toBe(400);
    // foreign subject → 400
    const bSubject = (await post("/api/v1/subjects", tok.b, { name: "Science", code: "SCI1" })).body;
    expect(
      (await post(`/api/v1/exams/${exam.id}/results`, tok.a, { results: [{ studentId: aStudent.id, subjectId: bSubject.id, marksObtained: 80 }] })).status
    ).toBe(400);
  });
});
