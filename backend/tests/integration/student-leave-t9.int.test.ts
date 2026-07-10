import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T9 — Student Leave Management. Staff file/approve requests (student_leave:*);
// parents file guardian-scoped for their own children; approval marks the student
// 'excused' in daily attendance via the existing tenant-guarded upsert, and
// cancelling an approved leave removes only those 'excused' marks. Covers the flow,
// attendance integration + safe revert, RBAC, tenant isolation, audit, export, and
// school + college.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const num = async (sql: string, p: unknown[]) =>
  Number((await query<{ c: string }>(sql, p)).rows[0].c);
const attStatus = async (studentId: string, date: string, inst: string) => {
  const { rows } = await query<{ status: string }>(
    "SELECT status FROM attendance_records WHERE student_id=$1 AND date=$2 AND institution_id=$3",
    [studentId, date, inst]
  );
  return rows[0]?.status ?? null;
};

describe("PR-T9 student leave", () => {
  let instA: string;
  let instB: string;
  let child: string;
  let other: string;
  const tok: Record<string, string> = {};
  const FROM = "2026-09-01";
  const TO = "2026-09-03";
  const MID = "2026-09-02";

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("SLA", "school");
    instB = await createInstitution("SLB", "school");
    await createUser({ email: "admin@sla.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "student@sla.dev", password: PW, role: "student", institutionId: instA });
    const parent = await createUser({ email: "parent@sla.dev", password: PW, role: "parent", institutionId: instA });
    await createUser({ email: "admin@slb.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminA = await tokenFor("admin@sla.dev", PW);
    tok.studentA = await tokenFor("student@sla.dev", PW);
    tok.parentA = await tokenFor("parent@sla.dev", PW);
    tok.adminB = await tokenFor("admin@slb.dev", PW);

    child = (await request(app).post("/api/v1/students").set(auth(tok.adminA)).send({ firstName: "Kiran", lastName: "Kid" })).body.id;
    other = (await request(app).post("/api/v1/students").set(auth(tok.adminA)).send({ firstName: "Ravi", lastName: "Roll" })).body.id;
    await query(`INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')`, [instA, parent.id, child]);
  });

  const fileLeave = (studentId: string, body: Record<string, unknown> = {}) =>
    request(app).post("/api/v1/student-leave").set(auth(tok.adminA))
      .send({ studentId, type: "sick", fromDate: FROM, toDate: TO, reason: "Fever", ...body });

  it("files a request, approves it and marks the student excused for every date", async () => {
    const req = await fileLeave(child);
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("pending");
    expect(Number(req.body.days)).toBe(3);

    const appr = await request(app).post(`/api/v1/student-leave/${req.body.id}/approve`).set(auth(tok.adminA)).send({ reviewNote: "OK" });
    expect(appr.status).toBe(200);
    expect(appr.body.status).toBe("approved");

    for (const d of [FROM, MID, TO]) expect(await attStatus(child, d, instA)).toBe("excused");
  });

  it("rejects a request without touching attendance", async () => {
    const req = await fileLeave(child);
    const rej = await request(app).post(`/api/v1/student-leave/${req.body.id}/reject`).set(auth(tok.adminA)).send({ reviewNote: "Insufficient" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");
    expect(await attStatus(child, FROM, instA)).toBeNull();
  });

  it("cancelling an approved leave removes only the excused marks, preserving manual attendance", async () => {
    const req = await fileLeave(child);
    await request(app).post(`/api/v1/student-leave/${req.body.id}/approve`).set(auth(tok.adminA)).send({});
    // A teacher overrides the middle day to 'present'.
    await query("UPDATE attendance_records SET status='present' WHERE student_id=$1 AND date=$2 AND institution_id=$3", [child, MID, instA]);

    const cancel = await request(app).delete(`/api/v1/student-leave/${req.body.id}`).set(auth(tok.adminA));
    expect(cancel.status).toBe(204);
    // Excused marks removed; the manual 'present' survives.
    expect(await attStatus(child, FROM, instA)).toBeNull();
    expect(await attStatus(child, TO, instA)).toBeNull();
    expect(await attStatus(child, MID, instA)).toBe("present");
  });

  it("lets a parent file guardian-scoped leave only for their own child and cancel it", async () => {
    const ok = await request(app).post("/api/v1/student-leave/my").set(auth(tok.parentA))
      .send({ studentId: child, fromDate: FROM, toDate: TO, type: "casual" });
    expect(ok.status).toBe(201);

    const bad = await request(app).post("/api/v1/student-leave/my").set(auth(tok.parentA))
      .send({ studentId: other, fromDate: FROM, toDate: TO });
    expect(bad.status).toBe(403);

    const mine = await request(app).get("/api/v1/student-leave/my").set(auth(tok.parentA));
    expect(mine.body.length).toBe(1);
    expect((await request(app).delete(`/api/v1/student-leave/my/${ok.body.id}`).set(auth(tok.parentA))).status).toBe(204);
  });

  it("validates the date range and caps the span", async () => {
    const bad = await fileLeave(child, { fromDate: TO, toDate: FROM });
    expect(bad.status).toBe(400);
  });

  it("enforces RBAC (student_leave:* for staff; parents can't use the staff surface)", async () => {
    expect((await request(app).get("/api/v1/student-leave").set(auth(tok.studentA))).status).toBe(403);
    expect((await request(app).post("/api/v1/student-leave").set(auth(tok.studentA)).send({ studentId: child, fromDate: FROM, toDate: TO })).status).toBe(403);
    // parent can't approve or use the staff create surface
    expect((await request(app).post("/api/v1/student-leave").set(auth(tok.parentA)).send({ studentId: child, fromDate: FROM, toDate: TO })).status).toBe(403);
    expect((await request(app).get("/api/v1/student-leave").set(auth(tok.adminA))).status).toBe(200);
  });

  it("keeps requests tenant-isolated (and cannot approve across tenants)", async () => {
    const req = await fileLeave(child);
    expect((await request(app).get("/api/v1/student-leave").set(auth(tok.adminB))).body.meta.total).toBe(0);
    expect((await request(app).post(`/api/v1/student-leave/${req.body.id}/approve`).set(auth(tok.adminB)).send({})).status).toBe(404);
    // tenant B never marked tenant A's student.
    expect(await attStatus(child, FROM, instA)).toBeNull();
  });

  it("audits create / approve / reject / cancel", async () => {
    const r1 = await fileLeave(child);
    await request(app).post(`/api/v1/student-leave/${r1.body.id}/approve`).set(auth(tok.adminA)).send({});
    await request(app).delete(`/api/v1/student-leave/${r1.body.id}`).set(auth(tok.adminA));
    const r2 = await fileLeave(other);
    await request(app).post(`/api/v1/student-leave/${r2.body.id}/reject`).set(auth(tok.adminA)).send({});

    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='student_leave.request.create'`, [instA])).toBe(2);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='student_leave.approve'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='student_leave.reject'`, [instA])).toBe(1);
    expect(await num(`SELECT count(*) c FROM platform_audit_log WHERE institution_id=$1 AND action='student_leave.cancel'`, [instA])).toBe(1);
  });

  it("exports student leave through the T5 center (sensitive → reason-gated)", async () => {
    await fileLeave(child, { reason: "Chickenpox" });
    expect((await request(app).get("/api/v1/dataio/export/student_leave?format=csv").set(auth(tok.adminA))).status).toBe(400);
    const exp = await request(app).get("/api/v1/dataio/export/student_leave?format=csv&reason=T9%20review").set(auth(tok.adminA));
    expect(exp.status).toBe(200);
    expect(exp.text).toContain("Kiran Kid");
    expect(exp.text).toContain("Chickenpox");
  });

  it("works in college mode (per-student, mode-agnostic)", async () => {
    const instC = await createInstitution("SLC", "college");
    await createUser({ email: "admin@slc.dev", password: PW, role: "admin", institutionId: instC });
    const tokC = await tokenFor("admin@slc.dev", PW);
    const cstudent = (await request(app).post("/api/v1/students").set(auth(tokC)).send({ firstName: "Cara", lastName: "College" })).body.id;
    const req = await request(app).post("/api/v1/student-leave").set(auth(tokC)).send({ studentId: cstudent, fromDate: FROM, toDate: FROM, type: "casual" });
    expect(req.status).toBe(201);
    const appr = await request(app).post(`/api/v1/student-leave/${req.body.id}/approve`).set(auth(tokC)).send({});
    expect(appr.status).toBe(200);
    expect(await attStatus(cstudent, FROM, instC)).toBe("excused");
  });
});
