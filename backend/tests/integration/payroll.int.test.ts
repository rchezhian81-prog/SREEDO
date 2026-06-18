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

describe("payroll management", () => {
  let instA: string;
  let t1: string; // linked to the teacher user
  let t2: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function makeComponent(code: string, type: "earning" | "deduction", calcType = "fixed", defaultValue = 0): Promise<string> {
    const res = await post("/api/v1/payroll/components", tok.admin, { name: code, code, type, calcType, defaultValue });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function payslipsFor(month: string, t = tok.admin) {
    return (await get(`/api/v1/payroll/payslips?month=${month}`, t)).body as Array<Record<string, string>>;
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("PAY");
    await createUser({ email: "admin@pay.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "accountant@pay.dev", password: PW, role: "accountant", institutionId: instA });
    const teacherUser = await createUser({ email: "teacher@pay.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "student@pay.dev", password: PW, role: "student", institutionId: instA });

    t1 = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name, user_id) VALUES ($1,'EMP-1','Asha','K',$2) RETURNING id`,
      [instA, teacherUser.id]
    );
    t2 = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1,'EMP-2','Bala','M') RETURNING id`,
      [instA]
    );

    const instB = await createInstitution("PAY2");
    await createUser({ email: "admin@pay2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "accountant", "teacher", "student"]) tok[r] = await tokenFor(`${r}@pay.dev`, PW);
    tok.badmin = await tokenFor("admin@pay2.dev", PW);
  });

  it("manages salary components and staff salary structures (with revision history)", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    const hra = await makeComponent("HRA", "earning", "percent");
    const pf = await makeComponent("PF", "deduction", "fixed");
    expect((await post("/api/v1/payroll/components", tok.admin, { name: "Dup", code: "BASIC", type: "earning" })).status).toBe(409);

    const struct = await post("/api/v1/payroll/structures", tok.admin, {
      teacherId: t1,
      components: [
        { componentId: basic, calcType: "fixed", value: 30000 },
        { componentId: hra, calcType: "percent", value: 40 },
        { componentId: pf, calcType: "fixed", value: 1800 },
      ],
    });
    expect(struct.status).toBe(201);
    const detail = await get(`/api/v1/payroll/structures/${struct.body.id}`, tok.admin);
    expect(detail.body.components).toHaveLength(3);

    // A new structure supersedes the active one (revision history).
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 35000 }] });
    const list = (await get(`/api/v1/payroll/structures?teacherId=${t1}`, tok.admin)).body;
    expect(list).toHaveLength(2);
    expect(list.filter((s: { isActive: boolean }) => s.isActive)).toHaveLength(1);
  });

  it("runs payroll computing gross/deductions/net (fixed + percent)", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    const hra = await makeComponent("HRA", "earning", "percent");
    const pf = await makeComponent("PF", "deduction", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, {
      teacherId: t1,
      components: [
        { componentId: basic, calcType: "fixed", value: 30000 },
        { componentId: hra, calcType: "percent", value: 40 }, // 40% of 30000 = 12000
        { componentId: pf, calcType: "fixed", value: 1800 },
      ],
    });

    const run = await post("/api/v1/payroll/runs", tok.accountant, { month: "2026-07" });
    expect(run.status).toBe(200);
    expect(run.body.generated).toBe(1); // only t1 has a structure

    const slips = await payslipsFor("2026-07");
    expect(slips).toHaveLength(1);
    expect(Number(slips[0].gross)).toBe(42000); // 30000 + 12000
    expect(Number(slips[0].deductions)).toBe(1800);
    expect(Number(slips[0].net)).toBe(40200);
  });

  it("deducts unpaid leave from the attendance summary", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, {
      teacherId: t1, components: [{ componentId: basic, value: 31000 }],
    });
    // Two unpaid leave days (no leave_type → unpaid) in July (31 days → ₹1000/day).
    await query(
      `INSERT INTO staff_attendance (institution_id, teacher_id, date, status)
       VALUES ($1,$2,'2026-07-01','leave'), ($1,$2,'2026-07-02','leave')`,
      [instA, t1]
    );

    await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });
    const slip = (await payslipsFor("2026-07"))[0];
    expect(Number(slip.unpaidLeave)).toBe(2);
    expect(Number(slip.gross)).toBe(31000);
    expect(Number(slip.deductions)).toBe(2000); // 31000/31 * 2
    expect(Number(slip.net)).toBe(29000);

    const dl = await get("/api/v1/report-center/unpaid_leave_deduction?month=2026-07", tok.admin);
    expect(Number(dl.body.rows[0].deduction)).toBe(2000);
  });

  it("prevents duplicate runs and supports recalc", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });

    expect((await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" })).body.generated).toBe(1);
    // Re-run without recalc → skipped, not duplicated.
    const again = await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });
    expect(again.body).toMatchObject({ generated: 0, skipped: 1 });
    expect(await payslipsFor("2026-07")).toHaveLength(1);
    // Recalc regenerates.
    const recalc = await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07", recalc: true });
    expect(recalc.body.generated).toBe(1);
  });

  it("finalizes/locks a run", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });
    const run = await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });

    const fin = await post(`/api/v1/payroll/runs/${run.body.runId}/finalize`, tok.admin, {});
    expect(fin.body.status).toBe("finalized");
    expect((await payslipsFor("2026-07"))[0].status).toBe("finalized");
    // A finalized month can't be re-run.
    expect((await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07", recalc: true })).status).toBe(409);
  });

  it("generates payslip PDFs, owner-scoped to the staff member", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t2, components: [{ componentId: basic, value: 20000 }] });
    await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });

    const slips = await payslipsFor("2026-07");
    const mine = slips.find((s) => s.teacherId === t1)!;
    const others = slips.find((s) => s.teacherId === t2)!;

    // Staff downloads their own payslip.
    const pdf = await get(`/api/v1/payroll/payslips/${mine.id}/pdf`, tok.teacher).buffer(true).parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    // …but not someone else's.
    expect((await get(`/api/v1/payroll/payslips/${others.id}/pdf`, tok.teacher)).status).toBe(403);
    // Admin downloads any.
    expect((await get(`/api/v1/payroll/payslips/${others.id}/pdf`, tok.admin).buffer(true).parse(binaryParser)).status).toBe(200);
    // Own-payslips list.
    const myList = await get("/api/v1/payroll/payslips/mine", tok.teacher);
    expect(myList.body).toHaveLength(1);
    expect(myList.body[0].teacherId).toBe(t1);
  });

  it("surfaces payroll reports in the Reports Center", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });
    await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });

    const reg = await get("/api/v1/report-center/payroll_register?month=2026-07", tok.accountant);
    expect(reg.status).toBe(200);
    expect(reg.body.rows).toHaveLength(1);
    expect(Number(reg.body.rows[0].net)).toBe(10000);

    const sal = await get("/api/v1/report-center/payroll_salary", tok.accountant);
    expect(Number(sal.body.rows.find((r: { employeeNo: string }) => r.employeeNo === "EMP-1").fixedEarnings)).toBe(10000);
  });

  it("enforces permission guards", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });
    // teacher: cannot manage components, run, or finalize.
    expect((await post("/api/v1/payroll/components", tok.teacher, { name: "X", code: "X", type: "earning" })).status).toBe(403);
    expect((await post("/api/v1/payroll/runs", tok.teacher, { month: "2026-07" })).status).toBe(403);
    expect((await get("/api/v1/payroll/payslips", tok.teacher)).status).toBe(403); // no payroll:read
    // accountant: can run, cannot delete a component.
    expect((await post("/api/v1/payroll/runs", tok.accountant, { month: "2026-07" })).status).toBe(200);
    expect((await del(`/api/v1/payroll/components/${basic}`, tok.accountant)).status).toBe(403);
    // student: no access.
    expect((await get("/api/v1/payroll/components", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const basic = await makeComponent("BASIC", "earning", "fixed");
    await post("/api/v1/payroll/structures", tok.admin, { teacherId: t1, components: [{ componentId: basic, value: 10000 }] });
    const run = await post("/api/v1/payroll/runs", tok.admin, { month: "2026-07" });
    const slipId = (await payslipsFor("2026-07"))[0].id;

    // B sees none of A's data and cannot reach A's payslip.
    expect((await get("/api/v1/payroll/components", tok.badmin)).body).toHaveLength(0);
    expect((await get("/api/v1/payroll/payslips?month=2026-07", tok.badmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/payroll/payslips/${slipId}`, tok.badmin)).status).toBe(404);
    expect((await get(`/api/v1/payroll/payslips/${slipId}/pdf`, tok.badmin)).status).toBe(404);
    // B cannot assign a structure to A's teacher.
    expect((await post("/api/v1/payroll/structures", tok.badmin, { teacherId: t1, components: [{ componentId: basic, value: 1 }] })).status).toBe(400);
    // Run id is real but belongs to A.
    expect(run.body.runId).toBeTruthy();
  });
});
