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

describe("fee refunds (/fee-refunds)", () => {
  let instA: string;
  let instB: string;
  let paymentId: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("REF");
    instB = await createInstitution("REF2");
    await createUser({ email: "admin@ref.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@ref2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@ref.dev", password: PW, role: "super_admin", institutionId: null });

    const studentId = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'REF-1', 'Sara', 'P') RETURNING id`,
      [instA]
    );
    const invoiceId = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1, 'INV-REF-1', $2, 'Term 1', 1000, '2026-12-31') RETURNING id`,
      [instA, studentId]
    );
    paymentId = await insertId(
      `INSERT INTO payments (institution_id, invoice_id, amount, method) VALUES ($1, $2, 1000, 'cash') RETURNING id`,
      [instA, invoiceId]
    );

    tok.admin = await tokenFor("admin@ref.dev", PW);
    tok.adminB = await tokenFor("admin@ref2.dev", PW);
    tok.super = await tokenFor("super@ref.dev", PW);
  });

  it("requires auth + tenant + admin role", async () => {
    expect((await request(app).get("/api/v1/fee-refunds")).status).toBe(401);
    expect((await request(app).get("/api/v1/fee-refunds").set(auth(tok.super))).status).toBe(403);
  });

  it("lists refundable payments, records a refund, and enforces the balance", async () => {
    const payments = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.admin));
    expect(payments.status).toBe(200);
    expect(payments.body).toHaveLength(1);
    expect(Number(payments.body[0].refundable)).toBe(1000);
    expect(payments.body[0].invoiceNo).toBe("INV-REF-1");

    // Partial refund.
    const refund = await request(app)
      .post("/api/v1/fee-refunds")
      .set(auth(tok.admin))
      .send({ paymentId, amount: 300, reason: "Bus opt-out" });
    expect(refund.status).toBe(201);
    expect(Number(refund.body.amount)).toBe(300);
    expect(refund.body.studentName).toContain("Sara");
    const refundId = refund.body.id as string;

    // Over-refund (300 + 800 > 1000) is rejected.
    const over = await request(app)
      .post("/api/v1/fee-refunds")
      .set(auth(tok.admin))
      .send({ paymentId, amount: 800, reason: "over-refund test" });
    expect(over.status).toBe(400);

    // Refundable balance reflects the partial refund.
    const after = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.admin));
    expect(Number(after.body[0].refundable)).toBe(700);

    // Listing shows the refund.
    const list = await request(app).get("/api/v1/fee-refunds").set(auth(tok.admin));
    expect(list.body.meta.total).toBe(1);

    // Delete it.
    expect(
      (await request(app).delete(`/api/v1/fee-refunds/${refundId}`).set(auth(tok.admin))).status
    ).toBe(204);
  });

  it("rejects a refund against a payment from another tenant", async () => {
    const res = await request(app)
      .post("/api/v1/fee-refunds")
      .set(auth(tok.adminB))
      .send({ paymentId, amount: 100, reason: "cross-tenant test" });
    expect(res.status).toBe(404);

    // And admin B sees no refunds / payments from tenant A.
    const list = await request(app).get("/api/v1/fee-refunds").set(auth(tok.adminB));
    expect(list.body.meta.total).toBe(0);
    const payments = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.adminB));
    expect(payments.body).toHaveLength(0);
  });
});
