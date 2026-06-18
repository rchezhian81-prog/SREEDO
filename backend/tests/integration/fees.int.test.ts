import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, resetDb, tokenFor } from "./helpers";

const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const STUDENT = { email: "student@test.dev", password: "Passw0rd!" };

describe("invoice amount_paid lifecycle", () => {
  let token: string;
  let studentId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...ADMIN, role: "admin" });
    token = await tokenFor(ADMIN.email, ADMIN.password);
    const student = await request(app)
      .post("/api/v1/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Fee", lastName: "Payer" });
    studentId = student.body.id;
  });

  async function createInvoice(amountDue: number) {
    const res = await request(app)
      .post("/api/v1/fees/invoices")
      .set("Authorization", `Bearer ${token}`)
      .send({ studentId, description: "Tuition", amountDue, dueDate: "2026-12-31" });
    expect(res.status).toBe(201);
    return res.body;
  }

  function pay(invoiceId: string, amount: number) {
    return request(app)
      .post(`/api/v1/fees/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount });
  }

  it("starts unpaid, then accumulates amount_paid and advances status", async () => {
    const invoice = await createInvoice(1000);
    expect(Number(invoice.amountPaid)).toBe(0);
    expect(invoice.status).toBe("pending");

    const partial = await pay(invoice.id, 400);
    expect(partial.status).toBe(200);
    expect(Number(partial.body.amountPaid)).toBe(400);
    expect(partial.body.status).toBe("partially_paid");

    const full = await pay(invoice.id, 600);
    expect(Number(full.body.amountPaid)).toBe(1000);
    expect(full.body.status).toBe("paid");

    // amount_paid is persisted, not just computed in the response.
    const fetched = await request(app)
      .get(`/api/v1/fees/invoices/${invoice.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(Number(fetched.body.amountPaid)).toBe(1000);
  });

  it("rejects overpayment", async () => {
    const invoice = await createInvoice(500);
    const res = await pay(invoice.id, 600);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds outstanding/i);
  });

  it("exposes the fee summary to staff only", async () => {
    await createUser({ ...STUDENT, role: "student" });
    const studentToken = await tokenFor(STUDENT.email, STUDENT.password);

    const denied = await request(app)
      .get("/api/v1/fees/summary")
      .set("Authorization", `Bearer ${studentToken}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get("/api/v1/fees/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveProperty("totalCollected");
  });
});
