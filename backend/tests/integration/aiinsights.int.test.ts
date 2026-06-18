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

describe("ai advanced (insights)", () => {
  let instA: string;
  let st1: string;
  let st2: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("AIX");
    await createUser({ email: "admin@aix.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@aix.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@aix.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "student@aix.dev", password: PW, role: "student", institutionId: instA });

    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'AIX-1','Asha','K') RETURNING id`,
      [instA]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'AIX-2','Bala','M') RETURNING id`,
      [instA]
    );

    // st1: 2 present / 8 absent over the last 10 days → 20% (at risk).
    for (let d = 1; d <= 10; d++) {
      const status = d <= 2 ? "present" : "absent";
      await query(
        `INSERT INTO attendance_records (institution_id, student_id, date, status)
         VALUES ($1,$2, CURRENT_DATE - ($3::int), $4)`,
        [instA, st1, d, status]
      );
    }
    // st2: 9 present / 1 absent → 90% (not at risk).
    for (let d = 1; d <= 10; d++) {
      const status = d <= 9 ? "present" : "absent";
      await query(
        `INSERT INTO attendance_records (institution_id, student_id, date, status)
         VALUES ($1,$2, CURRENT_DATE - ($3::int), $4)`,
        [instA, st2, d, status]
      );
    }

    // Fees: one overdue pending, one future pending.
    await query(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, amount_paid, status, due_date)
       VALUES ($1,'AIX-INV1',$2,'Tuition',1000,0,'pending', CURRENT_DATE - 10),
              ($1,'AIX-INV2',$3,'Tuition',500,100,'partially_paid', CURRENT_DATE + 30)`,
      [instA, st1, st2]
    );

    // A document for search.
    await query(
      `INSERT INTO documents (institution_id, owner_type, owner_id, category, original_name, safe_name, mime_type, size_bytes, storage_key, storage_mode)
       VALUES ($1,'student',$2,'document','Asha Report Card.pdf','x.pdf','application/pdf',100,'private/secret-key.pdf','local')`,
      [instA, st1]
    );

    // Workflow signals: a pending leave + a low-stock item.
    const teacherRec = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1,'E1','T','R') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO leave_requests (institution_id, teacher_id, start_date, end_date, days, status)
       VALUES ($1,$2, CURRENT_DATE, CURRENT_DATE, 1, 'pending')`,
      [instA, teacherRec]
    );
    await query(
      `INSERT INTO inventory_items (institution_id, name, code, current_stock, min_stock_level)
       VALUES ($1,'Chalk','CHK',1,5)`,
      [instA]
    );

    for (const r of ["admin", "teacher", "accountant", "student"]) tok[r] = await tokenFor(`${r}@aix.dev`, PW);
  });

  it("returns report summaries with graceful AI fallback (no OpenAI)", async () => {
    const att = await get("/api/v1/ai-insights/summary/attendance", tok.admin);
    expect(att.status).toBe(200);
    expect(att.body.aiAvailable).toBe(false); // OPENAI_API_KEY not set in tests
    expect(att.body.narrative).toBeNull();
    expect(att.body.metrics.students).toBe(2);

    const fees = await get("/api/v1/ai-insights/summary/fees", tok.admin);
    expect(Number(fees.body.metrics.outstanding)).toBe(1400); // 1000 + 400
    expect(fees.body.metrics.overdueInvoices).toBe(1);

    expect((await get("/api/v1/ai-insights/summary/nope", tok.admin)).status).toBe(400);
  });

  it("computes attendance risk deterministically", async () => {
    const res = await get("/api/v1/ai-insights/risk/attendance?threshold=75&windowDays=60", tok.admin);
    expect(res.status).toBe(200);
    const ids = res.body.students.map((s: { studentId: string }) => s.studentId);
    expect(ids).toContain(st1); // 20%
    expect(ids).not.toContain(st2); // 90%
    const asha = res.body.students.find((s: { studentId: string }) => s.studentId === st1);
    expect(asha.rate).toBe(20);
    expect(res.body.narrative).toBeNull();
  });

  it("computes fee pending risk", async () => {
    const res = await get("/api/v1/ai-insights/risk/fees", tok.accountant);
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(2);
    expect(res.body.overdueCount).toBe(1);
    expect(Number(res.body.totalOutstanding)).toBe(1400);
    expect(res.body.suggestedAction).toBeTruthy();
  });

  it("falls back to keyword document search when embeddings are unconfigured", async () => {
    const res = await get("/api/v1/ai-insights/search?q=report", tok.admin);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("keyword");
    expect(res.body.results.length).toBeGreaterThanOrEqual(1);
    expect(res.body.results[0].name).toContain("Report Card");
    // Never leaks the private storage key.
    expect(JSON.stringify(res.body)).not.toContain("secret-key");
  });

  it("generates deterministic workflow suggestions from tenant data", async () => {
    const res = await get("/api/v1/ai-insights/suggestions", tok.admin);
    expect(res.status).toBe(200);
    const keys = res.body.suggestions.map((s: { key: string }) => s.key);
    expect(keys).toContain("fee_reminders");
    expect(keys).toContain("pending_leave");
    expect(keys).toContain("low_stock");
    const fee = res.body.suggestions.find((s: { key: string }) => s.key === "fee_reminders");
    expect(fee.count).toBe(2);
  });

  it("enforces permission guards", async () => {
    // teacher: read + summarize + search; NOT risk/suggestions.
    expect((await get("/api/v1/ai-insights/dashboard", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/ai-insights/summary/attendance", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/ai-insights/search?q=report", tok.teacher)).status).toBe(200);
    expect((await get("/api/v1/ai-insights/risk/attendance", tok.teacher)).status).toBe(403);
    expect((await get("/api/v1/ai-insights/risk/fees", tok.teacher)).status).toBe(403);
    expect((await get("/api/v1/ai-insights/suggestions", tok.teacher)).status).toBe(403);
    // accountant: has risk alerts.
    expect((await get("/api/v1/ai-insights/risk/fees", tok.accountant)).status).toBe(200);
    // student: no AI access at all.
    expect((await get("/api/v1/ai-insights/dashboard", tok.student)).status).toBe(403);
    expect((await get("/api/v1/ai-insights/summary/attendance", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const instB = await createInstitution("AIX2");
    await createUser({ email: "admin@aix2.dev", password: PW, role: "admin", institutionId: instB });
    const badmin = await tokenFor("admin@aix2.dev", PW);

    // B sees none of A's data.
    expect((await get("/api/v1/ai-insights/summary/attendance", badmin)).body.metrics.students).toBe(0);
    expect((await get("/api/v1/ai-insights/risk/attendance", badmin)).body.count).toBe(0);
    expect((await get("/api/v1/ai-insights/risk/fees", badmin)).body.pendingCount).toBe(0);
    expect((await get("/api/v1/ai-insights/search?q=report", badmin)).body.results).toHaveLength(0);
    expect((await get("/api/v1/ai-insights/suggestions", badmin)).body.suggestions).toHaveLength(0);
  });
});
