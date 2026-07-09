import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

// PR-T5 — Tenant Import/Export Center. Covers: dry-run (per-row errors, no
// writes), all-or-nothing commit, tenant isolation, RBAC (data_io gate +
// per-entity composition), sensitive-export reason-gate + audit, CSV formula
// -injection sanitisation, and import history.

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await query<{ c: string }>(sql, params);
  return Number(rows[0].c);
}

describe("PR-T5 tenant import/export center", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("IOA", "school");
    instB = await createInstitution("IOB", "school");
    await createUser({ email: "admin@ioa.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@ioa.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "student@ioa.dev", password: PW, role: "student", institutionId: instA });
    await createUser({ email: "admin@iob.dev", password: PW, role: "admin", institutionId: instB });

    // Baseline: a class in A (for sections import FK) + a student in A (for export).
    await query(`INSERT INTO classes (institution_id, name, grade_level) VALUES ($1, 'Grade 1', 1)`, [instA]);
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, status)
       VALUES ($1, 'IOA-1', 'Ravi', 'Kumar', 'active')`,
      [instA]
    );

    tok.adminA = await tokenFor("admin@ioa.dev", PW);
    tok.teacherA = await tokenFor("teacher@ioa.dev", PW);
    tok.studentA = await tokenFor("student@ioa.dev", PW);
    tok.adminB = await tokenFor("admin@iob.dev", PW);
  });

  // ---- guards -------------------------------------------------------------
  it("guards the surface (auth, staff, data_io permission)", async () => {
    expect((await request(app).get("/api/v1/dataio/entities")).status).toBe(401);
    // student is not staff → 403
    expect(
      (await request(app).get("/api/v1/dataio/entities").set(auth(tok.studentA))).status
    ).toBe(403);
    // teacher is staff but lacks data_io:import → 403 on import
    const r = await request(app)
      .post("/api/v1/dataio/import/subjects/dry-run")
      .set(auth(tok.teacherA))
      .send({ csv: "name,code\nMath,MATH" });
    expect(r.status).toBe(403);
  });

  it("lists a mode-filtered catalogue for the admin", async () => {
    const res = await request(app).get("/api/v1/dataio/entities").set(auth(tok.adminA));
    expect(res.status).toBe(200);
    const importKeys = res.body.imports.map((e: { key: string }) => e.key);
    expect(importKeys).toContain("students");
    expect(importKeys).toContain("subjects");
    // college-only entity must not appear for a school tenant
    expect(importKeys).not.toContain("programs");
    const exportKeys = res.body.exports.map((e: { key: string }) => e.key);
    expect(exportKeys).toContain("students");
  });

  // ---- import dry-run ------------------------------------------------------
  it("dry-run reports per-row errors and writes nothing", async () => {
    const before = await count(`SELECT count(*) c FROM subjects WHERE institution_id = $1`, [instA]);
    const csv = "name,code\nMathematics,MATH\n,SCI\nDuplicate,MATH"; // row2 missing name, row3 dup code in-file
    const res = await request(app)
      .post("/api/v1/dataio/import/subjects/dry-run")
      .set(auth(tok.adminA))
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.valid).toBe(1);
    expect(res.body.invalid).toBe(2);
    // nothing written
    expect(await count(`SELECT count(*) c FROM subjects WHERE institution_id = $1`, [instA])).toBe(before);
    // a dry-run batch is persisted
    expect(await count(`SELECT count(*) c FROM import_batches WHERE institution_id = $1 AND status = 'dry_run'`, [instA])).toBe(1);
  });

  // ---- import commit: all-or-nothing --------------------------------------
  it("rejects a commit with any invalid row and writes nothing (all-or-nothing)", async () => {
    const csv = "name,code\nMathematics,MATH\nScience,MATH"; // row2 dup code in-file
    const res = await request(app)
      .post("/api/v1/dataio/import/subjects/commit")
      .set(auth(tok.adminA))
      .send({ csv });
    expect(res.status).toBe(400);
    expect(await count(`SELECT count(*) c FROM subjects WHERE institution_id = $1`, [instA])).toBe(0);
    expect(await count(`SELECT count(*) c FROM import_batches WHERE institution_id = $1 AND status = 'failed'`, [instA])).toBe(1);
  });

  it("commits a fully-valid file atomically", async () => {
    const csv = "name,code\nMathematics,MATH\nScience,SCI";
    const res = await request(app)
      .post("/api/v1/dataio/import/subjects/commit")
      .set(auth(tok.adminA))
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);
    expect(await count(`SELECT count(*) c FROM subjects WHERE institution_id = $1`, [instA])).toBe(2);
    expect(await count(`SELECT count(*) c FROM import_batches WHERE institution_id = $1 AND status = 'committed'`, [instA])).toBe(1);
  });

  it("resolves FKs within the tenant only (sections → class)", async () => {
    // Class 'Grade 1' exists in A only. A can attach a section; the class name is
    // resolved per-tenant, so a class that isn't in this tenant is rejected.
    const ok = await request(app)
      .post("/api/v1/dataio/import/sections/commit")
      .set(auth(tok.adminA))
      .send({ csv: "className,sectionName\nGrade 1,A" });
    expect(ok.status).toBe(200);
    const bad = await request(app)
      .post("/api/v1/dataio/import/sections/dry-run")
      .set(auth(tok.adminA))
      .send({ csv: "className,sectionName\nNonexistent,B" });
    expect(bad.body.invalid).toBe(1);
    expect(bad.body.rows[0].errors[0].field).toBe("className");
  });

  it("keeps imports tenant-isolated", async () => {
    await request(app)
      .post("/api/v1/dataio/import/subjects/commit")
      .set(auth(tok.adminA))
      .send({ csv: "name,code\nMathematics,MATH" });
    // B is untouched, and B can independently use the same code.
    expect(await count(`SELECT count(*) c FROM subjects WHERE institution_id = $1`, [instB])).toBe(0);
    const b = await request(app)
      .post("/api/v1/dataio/import/subjects/commit")
      .set(auth(tok.adminB))
      .send({ csv: "name,code\nMath,MATH" });
    expect(b.status).toBe(200);
  });

  // ---- export -------------------------------------------------------------
  it("requires a reason for a sensitive export, then returns + audits it", async () => {
    const noReason = await request(app).get("/api/v1/dataio/export/students").set(auth(tok.adminA));
    expect(noReason.status).toBe(400);

    const ok = await request(app)
      .get("/api/v1/dataio/export/students?format=csv&reason=Board%20audit")
      .set(auth(tok.adminA));
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/csv");
    expect(ok.text).toContain("Ravi");
    // audited
    expect(
      await count(
        `SELECT count(*) c FROM platform_audit_log WHERE institution_id = $1 AND action = 'data_io.export.download'`,
        [instA]
      )
    ).toBe(1);
  });

  it("sanitises CSV formula-injection on export", async () => {
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, status)
       VALUES ($1, 'IOA-2', '=SUM(A1)', 'Evil', 'active')`,
      [instA]
    );
    const res = await request(app)
      .get("/api/v1/dataio/export/students?format=csv&reason=check")
      .set(auth(tok.adminA));
    expect(res.status).toBe(200);
    // the leading = is neutralised with a leading apostrophe
    expect(res.text).toContain("'=SUM(A1)");
    expect(res.text).not.toMatch(/(^|,)=SUM\(A1\)/);
  });

  it("composes per-entity permission on top of data_io:export", async () => {
    // Deny admin fees:read in A → the fees export is blocked even though the
    // caller still holds data_io:export.
    await query(
      `INSERT INTO tenant_role_permissions (institution_id, role, permission_key, effect)
       VALUES ($1, 'admin', 'fees:read', 'deny')`,
      [instA]
    );
    const res = await request(app)
      .get("/api/v1/dataio/export/fees_dues?reason=x")
      .set(auth(tok.adminA));
    expect(res.status).toBe(403);
  });

  // ---- history ------------------------------------------------------------
  it("records import history with reviewable row errors", async () => {
    await request(app)
      .post("/api/v1/dataio/import/subjects/dry-run")
      .set(auth(tok.adminA))
      .send({ csv: "name,code\n,BAD" });
    const list = await request(app).get("/api/v1/dataio/imports").set(auth(tok.adminA));
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    const rows = await request(app)
      .get(`/api/v1/dataio/imports/${list.body[0].id}/rows`)
      .set(auth(tok.adminA));
    expect(rows.status).toBe(200);
    expect(rows.body[0].valid).toBe(false);
    expect(rows.body[0].errors.length).toBeGreaterThan(0);
  });

  // ---- assignments (scope items 5 & 6) ------------------------------------
  it("imports student section placement (school)", async () => {
    await query(
      `INSERT INTO sections (institution_id, class_id, name)
       SELECT $1, id, 'A' FROM classes WHERE institution_id = $1 AND name = 'Grade 1'`,
      [instA]
    );
    const res = await request(app)
      .post("/api/v1/dataio/import/student_placement/commit")
      .set(auth(tok.adminA))
      .send({ csv: "admissionNo,className,sectionName\nIOA-1,Grade 1,A" });
    expect(res.status).toBe(200);
    const placed = await count(
      `SELECT count(*) c FROM students s JOIN sections sec ON sec.id = s.section_id
       WHERE s.institution_id = $1 AND s.admission_no = 'IOA-1' AND sec.name = 'A'`,
      [instA]
    );
    expect(placed).toBe(1);
  });

  it("imports section-subject assignment (school)", async () => {
    await query(
      `INSERT INTO sections (institution_id, class_id, name)
       SELECT $1, id, 'A' FROM classes WHERE institution_id = $1 AND name = 'Grade 1'`,
      [instA]
    );
    await query(`INSERT INTO subjects (institution_id, name, code) VALUES ($1, 'Math', 'MATH')`, [instA]);
    const res = await request(app)
      .post("/api/v1/dataio/import/section_subject/commit")
      .set(auth(tok.adminA))
      .send({ csv: "className,sectionName,subjectCode\nGrade 1,A,MATH" });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
  });

  it("imports college student enrollment", async () => {
    const col = await createInstitution("IOC", "college");
    await createUser({ email: "admin@ioc.dev", password: PW, role: "admin", institutionId: col });
    const colTok = await tokenFor("admin@ioc.dev", PW);
    const dept = (await query<{ id: string }>(
      `INSERT INTO departments (institution_id, name, code) VALUES ($1,'Sci','SCI') RETURNING id`, [col]
    )).rows[0].id;
    await query(
      `INSERT INTO programs (institution_id, department_id, name, code) VALUES ($1,$2,'B.Sc','BSC')`, [col, dept]
    );
    await query(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, status)
       VALUES ($1,'IOC-1','Meena','Rao','active')`,
      [col]
    );
    const res = await request(app)
      .post("/api/v1/dataio/import/student_enrollment/commit")
      .set(auth(colTok))
      .send({ csv: "admissionNo,programCode\nIOC-1,BSC" });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(await count(`SELECT count(*) c FROM enrollments WHERE institution_id = $1`, [col])).toBe(1);
  });
});
