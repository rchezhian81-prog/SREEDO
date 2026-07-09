import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T6 — Staff Master (non-teaching). Non-teaching staff live in the teachers
// table with staff_type='non_teaching'; teaching stays the default so existing
// teacher/faculty flows are unchanged. Covers: default backfill, teaching-only
// default list, non-teaching directory, HR-wiring reuse, import/export round-trip
// (via T5), RBAC, tenant isolation, and audit.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const num = async (sql: string, p: unknown[]) =>
  Number((await query<{ c: string }>(sql, p)).rows[0].c);

describe("PR-T6 staff master (non-teaching)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("SMA", "school");
    instB = await createInstitution("SMB", "school");
    await createUser({ email: "admin@sma.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@sma.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "student@sma.dev", password: PW, role: "student", institutionId: instA });
    await createUser({ email: "admin@smb.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminA = await tokenFor("admin@sma.dev", PW);
    tok.teacherA = await tokenFor("teacher@sma.dev", PW);
    tok.studentA = await tokenFor("student@sma.dev", PW);
    tok.adminB = await tokenFor("admin@smb.dev", PW);
  });

  const createStaff = (t: string, body: Record<string, unknown>) =>
    request(app).post("/api/v1/teachers").set(auth(t)).send(body);

  it("defaults new records to teaching and keeps the Teachers list teaching-only", async () => {
    const teach = await createStaff(tok.adminA, { firstName: "Tara", lastName: "Teach" });
    expect(teach.status).toBe(201);
    expect(teach.body.staffType).toBe("teaching");

    const nonTeach = await createStaff(tok.adminA, {
      firstName: "Nadia", lastName: "Non", staffType: "non_teaching", designation: "Accountant", department: "Accounts",
    });
    expect(nonTeach.status).toBe(201);
    expect(nonTeach.body.staffType).toBe("non_teaching");
    expect(nonTeach.body.designation).toBe("Accountant");

    // Default list = teaching only (non-teaching does NOT appear as a teacher).
    const def = await request(app).get("/api/v1/teachers").set(auth(tok.adminA));
    const defNames = def.body.data.map((r: { firstName: string }) => r.firstName);
    expect(defNames).toContain("Tara");
    expect(defNames).not.toContain("Nadia");

    // Staff directory = non-teaching only.
    const nt = await request(app).get("/api/v1/teachers?staffType=non_teaching").set(auth(tok.adminA));
    const ntNames = nt.body.data.map((r: { firstName: string }) => r.firstName);
    expect(ntNames).toContain("Nadia");
    expect(ntNames).not.toContain("Tara");

    // all = everyone.
    const all = await request(app).get("/api/v1/teachers?staffType=all").set(auth(tok.adminA));
    expect(all.body.data.length).toBe(2);
  });

  it("lets non-teaching staff reuse the existing HR wiring (staff attendance FK)", async () => {
    const staff = await createStaff(tok.adminA, {
      firstName: "Raju", lastName: "Driver", staffType: "non_teaching", designation: "Driver",
    });
    // The non-teaching staff id is a valid teachers.id, so staff_attendance
    // (which FKs teachers.id) accepts it — proving the shared-table reuse.
    await query(
      `INSERT INTO staff_attendance (institution_id, teacher_id, date, status)
       VALUES ($1, $2, CURRENT_DATE, 'present')`,
      [instA, staff.body.id]
    );
    expect(
      await num(`SELECT count(*) c FROM staff_attendance WHERE institution_id = $1 AND teacher_id = $2`, [instA, staff.body.id])
    ).toBe(1);
  });

  it("updates a non-teaching staff record", async () => {
    const staff = await createStaff(tok.adminA, { firstName: "Uma", lastName: "Clerk", staffType: "non_teaching", designation: "Clerk" });
    const upd = await request(app).patch(`/api/v1/teachers/${staff.body.id}`).set(auth(tok.adminA)).send({ designation: "Senior Clerk" });
    expect(upd.status).toBe(200);
    expect(upd.body.designation).toBe("Senior Clerk");
    expect(upd.body.staffType).toBe("non_teaching");
  });

  it("round-trips staff_type + designation through the T5 import/export center", async () => {
    const imp = await request(app)
      .post("/api/v1/dataio/import/teachers/commit")
      .set(auth(tok.adminA))
      .send({ csv: "firstName,lastName,staffType,designation\nAmy,Teacher,teaching,\nBob,Bursar,non_teaching,Bursar" });
    expect(imp.status).toBe(200);
    expect(imp.body.imported).toBe(2);

    // The imported non-teaching staff is absent from the default teacher list...
    const def = await request(app).get("/api/v1/teachers").set(auth(tok.adminA));
    expect(def.body.data.map((r: { firstName: string }) => r.firstName)).not.toContain("Bob");
    // ...present in the non-teaching directory...
    const nt = await request(app).get("/api/v1/teachers?staffType=non_teaching").set(auth(tok.adminA));
    expect(nt.body.data.map((r: { firstName: string }) => r.firstName)).toContain("Bob");
    // ...and the export carries the staff type + designation.
    const exp = await request(app)
      .get("/api/v1/dataio/export/teachers?format=csv&reason=T6%20check")
      .set(auth(tok.adminA));
    expect(exp.status).toBe(200);
    expect(exp.text).toContain("Staff Type");
    expect(exp.text).toContain("Bursar");
    expect(exp.text).toContain("non_teaching");
  });

  it("enforces RBAC (teachers:manage) and staff-only reads", async () => {
    expect((await createStaff(tok.teacherA, { firstName: "X", lastName: "Y", staffType: "non_teaching" })).status).toBe(403);
    expect((await request(app).get("/api/v1/teachers").set(auth(tok.studentA))).status).toBe(403);
  });

  it("keeps non-teaching staff tenant-isolated", async () => {
    await createStaff(tok.adminA, { firstName: "Zia", lastName: "Peon", staffType: "non_teaching", designation: "Peon" });
    const bList = await request(app).get("/api/v1/teachers?staffType=all").set(auth(tok.adminB));
    expect(bList.body.data.length).toBe(0);
  });

  it("audits staff creation", async () => {
    await createStaff(tok.adminA, { firstName: "Ivy", lastName: "Ops", staffType: "non_teaching", designation: "Office Manager" });
    expect(
      await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action = 'staff.create'`, [instA])
    ).toBe(1);
  });

  // ---- pre-merge safety: non-teaching staff cannot be assigned to teach ----
  it("blocks assigning a non-teaching staff member to teach a subject (direct + import)", async () => {
    const classId = (await query<{ id: string }>(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'G1',1) RETURNING id`, [instA]
    )).rows[0].id;
    const sectionId = (await query<{ id: string }>(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`, [instA, classId]
    )).rows[0].id;
    const subjectId = (await query<{ id: string }>(
      `INSERT INTO subjects (institution_id, name, code) VALUES ($1,'Math','MATH') RETURNING id`, [instA]
    )).rows[0].id;
    const nonTeach = await createStaff(tok.adminA, { firstName: "Dee", lastName: "Driver", staffType: "non_teaching", designation: "Driver", employeeNo: "NT-9" });
    const teach = await createStaff(tok.adminA, { firstName: "Tia", lastName: "Teach", employeeNo: "TE-9" });

    // Direct assignment endpoint: non-teaching UUID is rejected...
    const bad = await request(app)
      .post(`/api/v1/sections/${sectionId}/subjects`)
      .set(auth(tok.adminA))
      .send({ subjectId, teacherId: nonTeach.body.id });
    expect(bad.status).toBe(400);
    // ...a teaching teacher is accepted.
    const ok = await request(app)
      .post(`/api/v1/sections/${sectionId}/subjects`)
      .set(auth(tok.adminA))
      .send({ subjectId, teacherId: teach.body.id });
    expect(ok.status).toBe(201);

    // Import path: a non-teaching employee_no does not resolve as a teacher.
    const dry = await request(app)
      .post("/api/v1/dataio/import/section_subject/dry-run")
      .set(auth(tok.adminA))
      .send({ csv: "className,sectionName,subjectCode,employeeNo\nG1,A,MATH,NT-9" });
    expect(dry.body.invalid).toBe(1);
    expect(JSON.stringify(dry.body.rows[0].errors)).toContain("employeeNo");
  });
});
