import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("disciplinary records", () => {
  let instA: string;
  let st1: string; // student user's own record
  let st2: string; // parent's linked child
  let st3: string; // unlinked
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  const newIncident = (t: string, studentId: string, over: Record<string, unknown> = {}) =>
    post("/api/v1/disciplinary", t, {
      studentId,
      incidentDate: "2026-06-01",
      category: "Misconduct",
      severity: "high",
      description: "Disrupted class",
      reportedBy: "Class Teacher",
      ...over,
    });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("DISC");
    await createUser({ email: "admin@d.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "acct@d.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "teacher@d.dev", password: PW, role: "teacher", institutionId: instA });
    const studentUser = await createUser({ email: "stud@d.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@d.dev", password: PW, role: "parent", institutionId: instA });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'DISC-7',7) RETURNING id`,
      [instA]
    );
    const sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, user_id)
       VALUES ($1,'D-1','Asha','K',$2,$3) RETURNING id`,
      [instA, sectionId, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id)
       VALUES ($1,'D-2','Bala','M',$2) RETURNING id`,
      [instA, sectionId]
    );
    st3 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'D-3','Chitra','N') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'parent')`,
      [instA, parentUser.id, st2]
    );

    for (const [k, e] of [
      ["admin", "admin@d.dev"],
      ["acct", "acct@d.dev"],
      ["teacher", "teacher@d.dev"],
      ["stud", "stud@d.dev"],
      ["parent", "parent@d.dev"],
    ] as const) {
      tok[k] = await tokenFor(e, PW);
    }
  });

  it("creates an incident, snapshots the student, and logs the trail", async () => {
    const res = await newIncident(tok.admin, st1);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("open");
    expect(res.body.severity).toBe("high");
    expect(res.body.admissionNo).toBe("D-1");
    expect(res.body.className).toBe("DISC-7");
    expect(res.body.sectionName).toBe("A");

    const actions = await get(`/api/v1/disciplinary/${res.body.id}/actions`, tok.admin);
    expect(actions.status).toBe(200);
    expect(actions.body.some((a: { action: string }) => a.action === "logged")).toBe(true);
  });

  it("updates an incident's details", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;
    const upd = await patch(`/api/v1/disciplinary/${id}`, tok.admin, {
      severity: "medium",
      category: "Late",
      remarks: "First warning",
    });
    expect(upd.status).toBe(200);
    expect(upd.body.severity).toBe("medium");
    expect(upd.body.category).toBe("Late");
    expect(upd.body.remarks).toBe("First warning");
  });

  it("runs the review → action → close workflow and locks terminal records", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;

    expect((await post(`/api/v1/disciplinary/${id}/review`, tok.admin, {})).body.status).toBe("under_review");

    const acted = await post(`/api/v1/disciplinary/${id}/action`, tok.admin, {
      actionTaken: "Parent counselled; suspended 1 day",
    });
    expect(acted.status).toBe(200);
    expect(acted.body.status).toBe("action_taken");
    expect(acted.body.actionTaken).toContain("counselled");

    const closed = await post(`/api/v1/disciplinary/${id}/close`, tok.admin, { note: "Resolved" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();

    // A closed record is immutable.
    expect((await patch(`/api/v1/disciplinary/${id}`, tok.admin, { severity: "low" })).status).toBe(400);
    expect((await post(`/api/v1/disciplinary/${id}/action`, tok.admin, { actionTaken: "x" })).status).toBe(400);

    // The trail captured each transition.
    const actions = await get(`/api/v1/disciplinary/${id}/actions`, tok.admin);
    const kinds = actions.body.map((a: { action: string }) => a.action);
    expect(kinds).toEqual(expect.arrayContaining(["logged", "review", "action_taken", "closed"]));
  });

  it("cancels an incident entered wrongly (retained for audit)", async () => {
    const id = (await newIncident(tok.admin, st3)).body.id;
    const cancelled = await post(`/api/v1/disciplinary/${id}/cancel`, tok.admin, { reason: "Wrong student" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    // Still retrievable (not deleted).
    expect((await get(`/api/v1/disciplinary/${id}`, tok.admin)).status).toBe(200);
  });

  it("gates cancel/delete/close by permission", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;
    // teacher has read/create/update/action but NOT close or delete.
    expect((await post(`/api/v1/disciplinary/${id}/close`, tok.teacher, {})).status).toBe(403);
    expect((await post(`/api/v1/disciplinary/${id}/cancel`, tok.teacher, {})).status).toBe(403);
    expect((await del(`/api/v1/disciplinary/${id}`, tok.teacher)).status).toBe(403);
    // teacher CAN log + act (positive permission check).
    expect((await newIncident(tok.teacher, st2)).status).toBe(201);
    expect((await post(`/api/v1/disciplinary/${id}/review`, tok.teacher, {})).status).toBe(200);
    // admin can hard-delete.
    expect((await del(`/api/v1/disciplinary/${id}`, tok.admin)).status).toBe(204);
    expect((await get(`/api/v1/disciplinary/${id}`, tok.admin)).status).toBe(404);
  });

  it("returns a student's disciplinary history (staff)", async () => {
    await newIncident(tok.admin, st1, { category: "A" });
    await newIncident(tok.admin, st1, { category: "B" });
    await newIncident(tok.admin, st2, { category: "C" });
    const hist = await get(`/api/v1/disciplinary/student/${st1}`, tok.admin);
    expect(hist.status).toBe(200);
    expect(hist.body).toHaveLength(2);
    expect(hist.body.every((r: { studentId: string }) => r.studentId === st1)).toBe(true);
  });

  it("keeps the portal OFF by default and owner-scopes it once enabled", async () => {
    await newIncident(tok.admin, st1);
    await newIncident(tok.admin, st2);

    // Default OFF: even the owner cannot see records in the portal.
    expect((await get("/api/v1/disciplinary/settings", tok.admin)).body.portalEnabled).toBe(false);
    expect((await get(`/api/v1/portal/students/${st1}/disciplinary`, tok.stud)).status).toBe(403);

    // Admin enables portal visibility.
    expect((await patch("/api/v1/disciplinary/settings", tok.admin, { portalEnabled: true })).body.portalEnabled).toBe(true);

    // Student sees own; not others.
    expect((await get(`/api/v1/portal/students/${st1}/disciplinary`, tok.stud)).status).toBe(200);
    expect((await get(`/api/v1/portal/students/${st2}/disciplinary`, tok.stud)).status).toBe(403);
    // Parent sees the linked child; not an unlinked student.
    expect((await get(`/api/v1/portal/students/${st2}/disciplinary`, tok.parent)).status).toBe(200);
    expect((await get(`/api/v1/portal/students/${st1}/disciplinary`, tok.parent)).status).toBe(403);
  });

  it("blocks students/parents/unprivileged staff from the admin register", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;
    // accountant has no disciplinary permissions at all.
    expect((await get("/api/v1/disciplinary", tok.acct)).status).toBe(403);
    // student/parent have only portal_read — never the admin endpoints.
    expect((await get("/api/v1/disciplinary", tok.stud)).status).toBe(403);
    expect((await get(`/api/v1/disciplinary/${id}`, tok.parent)).status).toBe(403);
    expect((await newIncident(tok.stud, st1)).status).toBe(403);
  });

  it("exposes disciplinary reports (permission-gated)", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;
    await post(`/api/v1/disciplinary/${id}/action`, tok.admin, { actionTaken: "Warned" });

    const reg = await get("/api/v1/report-center/disciplinary_register", tok.admin);
    expect(reg.status).toBe(200);
    expect(reg.body.rows.length).toBe(1);

    for (const key of [
      "disciplinary_student_history",
      "disciplinary_by_category",
      "disciplinary_by_severity",
      "disciplinary_open_pending",
      "disciplinary_action_taken",
    ]) {
      expect((await get(`/api/v1/report-center/${key}`, tok.admin)).status).toBe(200);
    }
    expect((await get("/api/v1/report-center/disciplinary_action_taken", tok.admin)).body.rows.length).toBe(1);

    // teacher has disciplinary:reports; accountant/student do not.
    expect((await get("/api/v1/report-center/disciplinary_register", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/report-center/disciplinary_register", tok.acct)).status).toBe(403);
    expect((await get("/api/v1/report-center/disciplinary_register", tok.stud)).status).toBe(403);
  });

  it("is tenant-isolated and denies cross-institution access", async () => {
    const id = (await newIncident(tok.admin, st1)).body.id;

    const instB = await createInstitution("DISC2");
    await createUser({ email: "admin@d2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@d2.dev", PW);

    expect((await get("/api/v1/disciplinary", bAdmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/disciplinary/${id}`, bAdmin)).status).toBe(404);
    expect((await post(`/api/v1/disciplinary/${id}/close`, bAdmin, {})).status).toBe(404);
    expect((await del(`/api/v1/disciplinary/${id}`, bAdmin)).status).toBe(404);
  });
});
