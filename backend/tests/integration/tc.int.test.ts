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
function binaryParser(res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("transfer certificates", () => {
  let instA: string;
  let st1: string; // student user's own record, no dues
  let st2: string; // parent's child, has dues
  let st3: string; // unlinked, no dues
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  const createDraft = (t: string, studentId: string) =>
    post("/api/v1/transfer-certificates", t, {
      studentId,
      leavingReason: "Relocation",
      conduct: "Good",
      academicYear: "2025-2026",
    });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("TC");
    await createUser({ email: "admin@tc.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "acct@tc.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "teacher@tc.dev", password: PW, role: "teacher", institutionId: instA });
    const studentUser = await createUser({ email: "stud@tc.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@tc.dev", password: PW, role: "parent", institutionId: instA });

    const classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'TC-5',5) RETURNING id`,
      [instA]
    );
    const sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, user_id, date_of_birth, guardian_name)
       VALUES ($1,'TC-1','Asha','K',$2,$3,'2012-05-01','Mr K') RETURNING id`,
      [instA, sectionId, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id)
       VALUES ($1,'TC-2','Bala','M',$2) RETURNING id`,
      [instA, sectionId]
    );
    st3 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'TC-3','Chitra','N') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'parent')`,
      [instA, parentUser.id, st2]
    );
    // st2 has an outstanding invoice (dues).
    await query(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1,'TC-INV2',$2,'Tuition',1500, CURRENT_DATE + 5)`,
      [instA, st2]
    );

    for (const [k, e] of [
      ["admin", "admin@tc.dev"],
      ["acct", "acct@tc.dev"],
      ["teacher", "teacher@tc.dev"],
      ["stud", "stud@tc.dev"],
      ["parent", "parent@tc.dev"],
    ] as const) {
      tok[k] = await tokenFor(e, PW);
    }
  });

  it("creates TC drafts with unique sequence-based numbers", async () => {
    const a = await createDraft(tok.admin, st1);
    const b = await createDraft(tok.admin, st3);
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("draft");
    expect(a.body.tcNo).toMatch(/^TC-\d{4}-\d{5}$/);
    expect(a.body.admissionNo).toBe("TC-1");
    expect(a.body.className).toBe("TC-5");
    expect(b.body.tcNo).not.toBe(a.body.tcNo); // unique
  });

  it("reports a student's dues for the pre-issue check", async () => {
    expect((await get(`/api/v1/transfer-certificates/student/${st1}/dues`, tok.admin)).body.hasDues).toBe(false);
    const d2 = await get(`/api/v1/transfer-certificates/student/${st2}/dues`, tok.admin);
    expect(d2.body.hasDues).toBe(true);
    expect(Number(d2.body.fee.amount)).toBe(1500);
  });

  it("issues a dues-free TC, generates the PDF, and marks the student transferred", async () => {
    const draft = (await createDraft(tok.acct, st1)).body;
    const issued = await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.acct, {});
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe("issued");
    expect(issued.body.dateOfIssue).toBeTruthy();
    expect(issued.body.feeDuesStatus).toBe("Cleared");

    const pdf = await get(`/api/v1/transfer-certificates/${draft.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");

    // Student lifecycle: marked transferred (data retained).
    const st = await query<{ status: string }>("SELECT status FROM students WHERE id=$1", [st1]);
    expect(st.rows[0].status).toBe("transferred");
    // Re-issuing is rejected (no longer a draft).
    expect((await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.admin, {})).status).toBe(400);
  });

  it("blocks issue when dues exist and gates the override by permission", async () => {
    const draft = (await createDraft(tok.admin, st2)).body;
    // No override → blocked.
    expect((await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.admin, {})).status).toBe(400);
    // accountant has issue but NOT override_dues → 403 when overriding.
    const acctTry = await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.acct, {
      overrideDues: true,
      overrideReason: "Will pay later",
    });
    expect(acctTry.status).toBe(403);
    // admin can override.
    const ok = await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.admin, {
      overrideDues: true,
      overrideReason: "Approved by principal",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.duesOverride).toBe(true);
  });

  it("cancels a TC and watermarks it (still downloadable by staff)", async () => {
    const draft = (await createDraft(tok.admin, st3)).body;
    await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.admin, {});
    const cancelled = await post(`/api/v1/transfer-certificates/${draft.id}/cancel`, tok.admin, {
      reason: "Issued in error",
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    const pdf = await get(`/api/v1/transfer-certificates/${draft.id}/download`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("owner-scopes the portal download (issued only, own/linked child)", async () => {
    // st1 issued (student's own).
    const own = (await createDraft(tok.admin, st1)).body;
    await post(`/api/v1/transfer-certificates/${own.id}/issue`, tok.admin, {});
    // st2 issued (parent's child, override dues).
    const child = (await createDraft(tok.admin, st2)).body;
    await post(`/api/v1/transfer-certificates/${child.id}/issue`, tok.admin, {
      overrideDues: true,
      overrideReason: "ok",
    });
    // st3 draft (not issued).
    const draft3 = (await createDraft(tok.admin, st3)).body;

    expect((await get(`/api/v1/transfer-certificates/${own.id}/download`, tok.stud)).status).toBe(200);
    expect((await get(`/api/v1/transfer-certificates/${child.id}/download`, tok.stud)).status).toBe(403); // not student's
    expect((await get(`/api/v1/transfer-certificates/${child.id}/download`, tok.parent)).status).toBe(200);
    expect((await get(`/api/v1/transfer-certificates/${draft3.id}/download`, tok.parent)).status).toBe(403); // not issued + not linked
    // student sees only own in the register.
    const list = await get("/api/v1/transfer-certificates", tok.stud);
    expect(list.body.every((t: { studentId: string }) => t.studentId === st1)).toBe(true);
  });

  it("enforces permission checks", async () => {
    // teacher has no TC permissions.
    expect((await get("/api/v1/transfer-certificates", tok.teacher)).status).toBe(403);
    expect((await createDraft(tok.teacher, st1)).status).toBe(403);
    // student cannot create, but can read (owner-scoped).
    expect((await createDraft(tok.stud, st1)).status).toBe(403);
    expect((await get("/api/v1/transfer-certificates", tok.stud)).status).toBe(200);
  });

  it("adds TC reports to the Reports Center", async () => {
    const draft = (await createDraft(tok.admin, st1)).body;
    await post(`/api/v1/transfer-certificates/${draft.id}/issue`, tok.admin, {});
    const reg = await get("/api/v1/report-center/tc_issued_register", tok.admin);
    expect(reg.status).toBe(200);
    expect(reg.body.rows.length).toBe(1);
    expect((await get("/api/v1/report-center/tc_pending_draft", tok.admin)).status).toBe(200);
    expect((await get("/api/v1/report-center/tc_student_leaving", tok.admin)).status).toBe(200);
    // teacher lacks transfer_certificates:read
    expect((await get("/api/v1/report-center/tc_issued_register", tok.teacher)).status).toBe(403);
  });

  it("is tenant-isolated and denies cross-institution access", async () => {
    const draft = (await createDraft(tok.admin, st1)).body;

    const instB = await createInstitution("TC2");
    await createUser({ email: "admin@tc2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@tc2.dev", PW);

    expect((await get("/api/v1/transfer-certificates", bAdmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/transfer-certificates/${draft.id}`, bAdmin)).status).toBe(404);
    expect((await post(`/api/v1/transfer-certificates/${draft.id}/issue`, bAdmin, {})).status).toBe(404);
    expect((await get(`/api/v1/transfer-certificates/${draft.id}/download`, bAdmin)).status).toBe(404);
  });
});
