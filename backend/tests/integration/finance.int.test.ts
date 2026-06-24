import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("finance / accounting (/finance)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("FIN");
    instB = await createInstitution("FIN2");
    await createUser({ email: "admin@fa.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@fb.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@f.dev", password: PW, role: "super_admin", institutionId: null });
    tok.adminA = await tokenFor("admin@fa.dev", PW);
    tok.adminB = await tokenFor("admin@fb.dev", PW);
    tok.super = await tokenFor("super@f.dev", PW);
  });

  it("requires auth and is institution-admin only", async () => {
    expect((await request(app).get("/api/v1/finance/transactions")).status).toBe(401);
    expect(
      (await request(app).get("/api/v1/finance/transactions").set(auth(tok.super))).status
    ).toBe(403);
  });

  it("records income/expense and computes a correct summary", async () => {
    const post = (b: unknown) =>
      request(app).post("/api/v1/finance/transactions").set(auth(tok.adminA)).send(b);
    expect((await post({ txnDate: "2026-06-01", type: "income", category: "Donation", amount: 1000 })).status).toBe(201);
    expect((await post({ txnDate: "2026-06-02", type: "income", category: "Misc", amount: 500 })).status).toBe(201);
    expect((await post({ txnDate: "2026-06-03", type: "expense", category: "Supplies", amount: 300 })).status).toBe(201);

    const list = await request(app).get("/api/v1/finance/transactions").set(auth(tok.adminA));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(3);

    const sum = await request(app).get("/api/v1/finance/summary").set(auth(tok.adminA));
    expect(sum.status).toBe(200);
    expect(sum.body.income).toBe(1500);
    expect(sum.body.expense).toBe(300);
    expect(sum.body.net).toBe(1200);

    const onlyExpense = await request(app)
      .get("/api/v1/finance/transactions?type=expense")
      .set(auth(tok.adminA));
    expect(onlyExpense.body.meta.total).toBe(1);
  });

  it("updates and deletes a transaction", async () => {
    const created = await request(app)
      .post("/api/v1/finance/transactions")
      .set(auth(tok.adminA))
      .send({ txnDate: "2026-06-01", type: "expense", category: "Misc", amount: 100 });
    const id = created.body.id as string;

    const upd = await request(app)
      .patch(`/api/v1/finance/transactions/${id}`)
      .set(auth(tok.adminA))
      .send({ amount: 250 });
    expect(upd.status).toBe(200);
    expect(upd.body.amount).toBe(250);

    expect(
      (await request(app).delete(`/api/v1/finance/transactions/${id}`).set(auth(tok.adminA))).status
    ).toBe(204);
    expect(
      (await request(app).get(`/api/v1/finance/transactions/${id}`).set(auth(tok.adminA))).status
    ).toBe(404);
  });

  it("isolates tenants — admin B cannot read admin A's transaction", async () => {
    const created = await request(app)
      .post("/api/v1/finance/transactions")
      .set(auth(tok.adminA))
      .send({ txnDate: "2026-06-01", type: "income", category: "X", amount: 10 });
    const id = created.body.id as string;
    expect(
      (await request(app).get(`/api/v1/finance/transactions/${id}`).set(auth(tok.adminB))).status
    ).toBe(404);
  });
});
