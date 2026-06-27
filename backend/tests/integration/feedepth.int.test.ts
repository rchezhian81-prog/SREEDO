import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("fee management depth", () => {
  let instA: string;
  let classId: string;
  let sectionId: string;
  let st1: string; // student user's own record (in section)
  let st2: string; // parent's child (in section)
  let st3: string; // unlinked, no section
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  async function newInvoice(no: string, studentId: string, amount: number, daysToDue: number) {
    return insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1,$2,$3,'Tuition',$4, CURRENT_DATE + ($5::int)) RETURNING id`,
      [instA, no, studentId, amount, daysToDue]
    );
  }

  beforeEach(async () => {
    await resetDb();
    delete process.env.PAYMENT_GATEWAY_PROVIDER;
    delete process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
    instA = await createInstitution("FMD");
    await createUser({ email: "admin@fmd.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "acct@fmd.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "teacher@fmd.dev", password: PW, role: "teacher", institutionId: instA });
    const studentUser = await createUser({ email: "stud@fmd.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@fmd.dev", password: PW, role: "parent", institutionId: instA });

    classId = await insertId(
      `INSERT INTO classes (institution_id, name, grade_level) VALUES ($1,'FMD-5',5) RETURNING id`,
      [instA]
    );
    sectionId = await insertId(
      `INSERT INTO sections (institution_id, class_id, name) VALUES ($1,$2,'A') RETURNING id`,
      [instA, classId]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id, user_id)
       VALUES ($1,'FMD-1','Asha','K',$2,$3) RETURNING id`,
      [instA, sectionId, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, section_id)
       VALUES ($1,'FMD-2','Bala','M',$2) RETURNING id`,
      [instA, sectionId]
    );
    st3 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'FMD-3','Chitra','N') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'parent')`,
      [instA, parentUser.id, st2]
    );

    for (const [k, e] of [
      ["admin", "admin@fmd.dev"],
      ["acct", "acct@fmd.dev"],
      ["teacher", "teacher@fmd.dev"],
      ["stud", "stud@fmd.dev"],
      ["parent", "parent@fmd.dev"],
    ] as const) {
      tok[k] = await tokenFor(e, PW);
    }
  });

  afterEach(() => {
    delete process.env.PAYMENT_GATEWAY_PROVIDER;
    delete process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
  });

  async function makeCategory(name = "Tuition"): Promise<string> {
    const res = await post("/api/v1/fees/categories", tok.admin, { name });
    return res.body.id as string;
  }

  it("does fee category CRUD (permission-gated)", async () => {
    const created = await post("/api/v1/fees/categories", tok.admin, { name: "Transport", code: "TRN" });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await get("/api/v1/fees/categories", tok.acct)).body.map((c: { name: string }) => c.name)).toContain("Transport");
    expect((await patch(`/api/v1/fees/categories/${id}`, tok.admin, { name: "Transport Fee" })).body.name).toBe("Transport Fee");
    // accountant cannot delete; teacher cannot read/create.
    expect((await del(`/api/v1/fees/categories/${id}`, tok.acct)).status).toBe(403);
    expect((await post("/api/v1/fees/categories", tok.teacher, { name: "X" })).status).toBe(403);
    expect((await del(`/api/v1/fees/categories/${id}`, tok.admin)).status).toBe(204);
  });

  it("creates a fee schedule", async () => {
    const cat = await makeCategory();
    const res = await post("/api/v1/fees/schedules", tok.admin, {
      name: "Term 1 Tuition",
      categoryId: cat,
      amount: 1000,
      termType: "term",
      termLabel: "Term 1",
      dueDate: "2026-07-31",
      classId,
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Term 1 Tuition");
    expect(Number(res.body.amount)).toBe(1000);
    expect(res.body.termLabel).toBe("Term 1");
  });

  it("generates term-wise invoices and prevents duplicates", async () => {
    const cat = await makeCategory();
    const sched = (await post("/api/v1/fees/schedules", tok.admin, {
      name: "Term 1", categoryId: cat, amount: 1200, dueDate: "2026-07-31", sectionId,
    })).body.id;

    const preview = await get(`/api/v1/fees/schedules/${sched}/preview`, tok.admin);
    expect(preview.body.toGenerate).toBe(2); // st1 + st2 are in the section

    const gen = await post(`/api/v1/fees/schedules/${sched}/generate`, tok.admin);
    expect(gen.status).toBe(200);
    expect(gen.body.created).toBe(2);

    const inv = await get(`/api/v1/fees/invoices?studentId=${st1}`, tok.admin);
    expect(inv.body.data).toHaveLength(1);
    expect(Number(inv.body.data[0].amountDue)).toBe(1200);

    // Re-running is idempotent — no new invoices.
    const again = await post(`/api/v1/fees/schedules/${sched}/generate`, tok.admin);
    expect(again.body.created).toBe(0);
    expect((await get(`/api/v1/fees/invoices?studentId=${st1}`, tok.admin)).body.data).toHaveLength(1);
  });

  it("calculates a per-day late fine and waives it (permission-gated)", async () => {
    const inv = await newInvoice("FMD-FINE", st1, 1000, -10); // due 10 days ago
    const rule = (await post("/api/v1/fees/fine-rules", tok.admin, {
      name: "Late", fineType: "per_day", amount: 5, graceDays: 2,
    })).body.id;

    const applied = await post(`/api/v1/fees/invoices/${inv}/fines`, tok.acct, { fineRuleId: rule });
    expect(applied.status).toBe(200);
    expect(Number(applied.body.fine.amount)).toBe(40); // 5 * (10 - 2)
    expect(Number(applied.body.amountDue)).toBe(1040);

    const bd = await get(`/api/v1/fees/invoices/${inv}/breakdown`, tok.admin);
    expect(Number(bd.body.fineTotal)).toBe(40);
    expect(Number(bd.body.base)).toBe(1000);

    const fineId = applied.body.fine.id;
    // accountant lacks fee_fines:waive
    expect((await post(`/api/v1/fees/applied-fines/${fineId}/waive`, tok.acct)).status).toBe(403);
    const waived = await post(`/api/v1/fees/applied-fines/${fineId}/waive`, tok.admin);
    expect(waived.status).toBe(200);
    expect(Number(waived.body.amountDue)).toBe(1000);
  });

  it("applies a discount and requires approval permission to take effect", async () => {
    const inv = await newInvoice("FMD-DISC", st1, 1000, 30);
    const applied = await post(`/api/v1/fees/invoices/${inv}/discounts`, tok.acct, {
      discountType: "percent", value: 10, reason: "Sibling",
    });
    expect(applied.status).toBe(200);
    expect(applied.body.discount.status).toBe("pending");
    expect(Number(applied.body.discount.amount)).toBe(100); // 10% of 1000

    // Not yet applied to the invoice.
    expect(Number((await get(`/api/v1/fees/invoices/${inv}/breakdown`, tok.admin)).body.invoice.amountDue)).toBe(1000);

    const discId = applied.body.discount.id;
    // accountant lacks fee_discounts:approve
    expect((await post(`/api/v1/fees/applied-discounts/${discId}/approve`, tok.acct)).status).toBe(403);
    const approved = await post(`/api/v1/fees/applied-discounts/${discId}/approve`, tok.admin);
    expect(approved.status).toBe(200);
    expect(Number(approved.body.amountDue)).toBe(900);

    const bd = await get(`/api/v1/fees/invoices/${inv}/breakdown`, tok.admin);
    expect(Number(bd.body.discountTotal)).toBe(100);
    expect(Number(bd.body.outstanding)).toBe(900);
  });

  it("scopes dues views to the owner (student/parent)", async () => {
    const inv1 = await newInvoice("FMD-O1", st1, 500, 30);
    const inv3 = await newInvoice("FMD-O3", st3, 700, 30);

    // student sees own invoice + breakdown, not st3's.
    expect((await get(`/api/v1/fees/invoices?studentId=${st1}`, tok.stud)).body.data).toHaveLength(1);
    expect((await get(`/api/v1/fees/invoices/${inv1}/breakdown`, tok.stud)).status).toBe(200);
    expect((await get(`/api/v1/fees/invoices/${inv3}/breakdown`, tok.stud)).status).toBe(403);

    // parent sees linked child (st2) only.
    expect((await get(`/api/v1/fees/invoices/${inv1}/breakdown`, tok.parent)).status).toBe(403);
  });

  it("produces class/student/category dues reports (fee_reports:read)", async () => {
    const cat = await makeCategory("Tuition");
    await query(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date, category_id)
       VALUES ($1,'FMD-R1',$2,'Tuition',1000, CURRENT_DATE + 10, $3),
              ($1,'FMD-R2',$4,'Tuition',500, CURRENT_DATE + 10, $3)`,
      [instA, st1, cat, st2]
    );

    const byClass = await get("/api/v1/report-center/fee_dues_class", tok.admin);
    expect(byClass.status).toBe(200);
    expect(Number(byClass.body.rows.reduce((s: number, r: { outstanding: string }) => s + Number(r.outstanding), 0))).toBe(1500);

    const byStudent = await get("/api/v1/report-center/fee_dues_student", tok.acct);
    expect(byStudent.status).toBe(200);
    expect(byStudent.body.rows.length).toBe(2);

    const byCat = await get("/api/v1/report-center/fee_dues_category", tok.admin);
    expect(byCat.body.rows.find((r: { category: string }) => r.category === "Tuition")).toBeTruthy();

    // teacher lacks fee_reports:read
    expect((await get("/api/v1/report-center/fee_dues_class", tok.teacher)).status).toBe(403);
  });

  it("stays compatible with the online payment gateway (net amount after fine)", async () => {
    process.env.PAYMENT_GATEWAY_PROVIDER = "generic";
    process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET = "whsec_test";
    const inv = await newInvoice("FMD-PAY", st1, 1000, -5);
    const rule = (await post("/api/v1/fees/fine-rules", tok.admin, {
      name: "Flat late", fineType: "fixed", amount: 50, graceDays: 0,
    })).body.id;
    await post(`/api/v1/fees/invoices/${inv}/fines`, tok.admin, { fineRuleId: rule });

    const order = await post("/api/v1/online-payments", tok.admin, { invoiceId: inv });
    expect(order.status).toBe(201);
    expect(Number(order.body.amount)).toBe(1050); // 1000 + 50 fine, charged net
  });

  it("is tenant-isolated", async () => {
    await makeCategory("Tuition");
    await newInvoice("FMD-T1", st1, 1000, 30);

    const instB = await createInstitution("FMD2");
    await createUser({ email: "admin@fmd2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@fmd2.dev", PW);

    expect((await get("/api/v1/fees/categories", bAdmin)).body).toHaveLength(0);
    expect((await get("/api/v1/report-center/fee_dues_student", bAdmin)).body.rows).toHaveLength(0);
  });

  it("denies cross-institution access to fee setup + invoices", async () => {
    const cat = await makeCategory("Tuition");
    const sched = (await post("/api/v1/fees/schedules", tok.admin, {
      name: "T", amount: 100, dueDate: "2026-07-31", sectionId,
    })).body.id;
    const inv = await newInvoice("FMD-X1", st1, 1000, 30);

    const instB = await createInstitution("FMD3");
    await createUser({ email: "admin@fmd3.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@fmd3.dev", PW);

    expect((await patch(`/api/v1/fees/categories/${cat}`, bAdmin, { name: "Z" })).status).toBe(404);
    expect((await post(`/api/v1/fees/schedules/${sched}/generate`, bAdmin)).status).toBe(404);
    expect((await get(`/api/v1/fees/invoices/${inv}/breakdown`, bAdmin)).status).toBe(404);
  });
});
