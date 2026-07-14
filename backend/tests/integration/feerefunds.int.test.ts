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
  let invoiceId: string;
  let paymentId: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (p: string, t: string, b?: unknown) =>
    request(app).post(p).set(auth(t)).send(b ?? {});

  const invoiceState = async () => {
    const { rows } = await query<{ amount_paid: string; status: string }>(
      "SELECT amount_paid, status FROM invoices WHERE id = $1",
      [invoiceId]
    );
    return { paid: Number(rows[0].amount_paid), status: rows[0].status };
  };

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
    invoiceId = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, amount_paid, status, due_date)
       VALUES ($1, 'INV-REF-1', $2, 'Term 1', 1000, 1000, 'paid', '2026-12-31') RETURNING id`,
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

  it("records a refund, enforces the balance, and reconciles the invoice ledger", async () => {
    const payments = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.admin));
    expect(payments.status).toBe(200);
    expect(Number(payments.body[0].refundable)).toBe(1000);

    // Partial refund → invoice net paid drops, status re-opens.
    const refund = await post("/api/v1/fee-refunds", tok.admin, {
      paymentId, amount: 300, reason: "Bus opt-out",
    });
    expect(refund.status).toBe(201);
    expect(await invoiceState()).toEqual({ paid: 700, status: "partially_paid" });

    // Over-refund (300 + 800 > 1000) rejected; ledger unchanged.
    expect((await post("/api/v1/fee-refunds", tok.admin, { paymentId, amount: 800, reason: "x" })).status).toBe(400);
    expect(await invoiceState()).toEqual({ paid: 700, status: "partially_paid" });

    // Refundable balance reflects the partial refund.
    const after = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.admin));
    expect(Number(after.body[0].refundable)).toBe(700);
  });

  it("voids a refund: restores the ledger and preserves the record (no hard delete)", async () => {
    const refund = await post("/api/v1/fee-refunds", tok.admin, {
      paymentId, amount: 1000, reason: "Full reversal",
    });
    const refundId = refund.body.id as string;
    expect(await invoiceState()).toEqual({ paid: 0, status: "pending" });

    // Void requires a reason.
    expect((await post(`/api/v1/fee-refunds/${refundId}/void`, tok.admin, {})).status).toBe(400);

    const voided = await post(`/api/v1/fee-refunds/${refundId}/void`, tok.admin, { reason: "Refund issued in error" });
    expect(voided.status).toBe(200);
    expect(voided.body.voidedAt).toBeTruthy();
    // Ledger restored, and the refund row is preserved (not deleted).
    expect(await invoiceState()).toEqual({ paid: 1000, status: "paid" });
    const list = await request(app).get("/api/v1/fee-refunds").set(auth(tok.admin));
    expect(list.body.meta.total).toBe(1);
    // Voided refund frees the refundable balance again.
    const payments = await request(app).get("/api/v1/fee-refunds/payments").set(auth(tok.admin));
    expect(Number(payments.body[0].refundable)).toBe(1000);

    // Double-void is rejected.
    expect((await post(`/api/v1/fee-refunds/${refundId}/void`, tok.admin, { reason: "again" })).status).toBe(400);
  });

  it("backfill reconcile is idempotent and non-destructive", async () => {
    // Simulate a historical refund recorded BEFORE this fix: a refund row exists
    // but the invoice ledger was never adjusted (amount_paid still 1000).
    await query(
      "INSERT INTO payment_refunds (institution_id, payment_id, amount, reason, method) VALUES ($1,$2,400,'legacy','cash')",
      [instA, paymentId]
    );
    expect(await invoiceState()).toEqual({ paid: 1000, status: "paid" }); // drifted

    const first = await post("/api/v1/fee-refunds/reconcile", tok.admin);
    expect(first.status).toBe(200);
    expect(first.body.adjusted).toHaveLength(1);
    expect(await invoiceState()).toEqual({ paid: 600, status: "partially_paid" });
    // The historical refund row is untouched (not deleted).
    const { rows } = await query<{ n: string }>("SELECT count(*) n FROM payment_refunds WHERE institution_id = $1", [instA]);
    expect(Number(rows[0].n)).toBe(1);

    // Idempotent: a second run changes nothing.
    const second = await post("/api/v1/fee-refunds/reconcile", tok.admin);
    expect(second.body.adjusted).toHaveLength(0);
    expect(await invoiceState()).toEqual({ paid: 600, status: "partially_paid" });
  });

  it("audits refund create and void", async () => {
    const refund = await post("/api/v1/fee-refunds", tok.admin, { paymentId, amount: 200, reason: "audit test" });
    await post(`/api/v1/fee-refunds/${refund.body.id}/void`, tok.admin, { reason: "audit void" });
    const { rows } = await query<{ action: string }>(
      "SELECT action FROM platform_audit_log WHERE institution_id = $1 AND action LIKE 'fee_refund.%' ORDER BY action",
      [instA]
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("fee_refund.created");
    expect(actions).toContain("fee_refund.voided");
  });

  it("rejects a refund/void against another tenant and isolates listings", async () => {
    const res = await post("/api/v1/fee-refunds", tok.adminB, { paymentId, amount: 100, reason: "cross-tenant" });
    expect(res.status).toBe(404);

    // Create a real refund in A, then tenant B cannot void it.
    const refund = await post("/api/v1/fee-refunds", tok.admin, { paymentId, amount: 100, reason: "own" });
    expect((await post(`/api/v1/fee-refunds/${refund.body.id}/void`, tok.adminB, { reason: "x" })).status).toBe(404);

    const list = await request(app).get("/api/v1/fee-refunds").set(auth(tok.adminB));
    expect(list.body.meta.total).toBe(0);
  });
});
