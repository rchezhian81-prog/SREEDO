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
import { signPayload } from "../../src/modules/onlinepayments/gateway";

const PW = "Passw0rd!";
const WH_SECRET = "whsec_supersecret_DO_NOT_LEAK";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}
function binaryParser(res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

function enableGateway(): void {
  process.env.PAYMENT_GATEWAY_PROVIDER = "generic";
  process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET = WH_SECRET;
  process.env.PAYMENT_CHECKOUT_BASE_URL = "https://pay.test/checkout";
}
function disableGateway(): void {
  delete process.env.PAYMENT_GATEWAY_PROVIDER;
  delete process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
  delete process.env.PAYMENT_CHECKOUT_BASE_URL;
}

interface Order {
  id: string;
  gatewayRef: string;
  status: string;
  amount: string;
  checkoutUrl: string;
  provider: string;
  paymentId: string | null;
}

describe("online fee gateway", () => {
  let instA: string;
  let st1: string; // student user's own record
  let st2: string; // parent's linked child
  let st3: string; // unlinked
  let inv1: string;
  let inv2: string;
  let inv3: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);

  const createOrder = (t: string, invoiceId: string) =>
    post("/api/v1/online-payments", t, { invoiceId });

  function webhook(order: Order, type: string, opts: { eventId?: string; amount?: number; sig?: string } = {}) {
    const body = {
      id: opts.eventId ?? `evt_${order.id}_${type}`,
      type: `payment.${type}`,
      data: {
        gatewayRef: order.gatewayRef,
        paymentId: `pay_${order.id}`,
        amount: opts.amount ?? Number(order.amount),
      },
    };
    const raw = JSON.stringify(body);
    const sig = opts.sig ?? signPayload(raw, WH_SECRET);
    return request(app)
      .post("/api/v1/online-payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", sig)
      .send(raw);
  }

  beforeEach(async () => {
    await resetDb();
    disableGateway();
    instA = await createInstitution("PAY");
    await createUser({ email: "admin@pay.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "acct@pay.dev", password: PW, role: "accountant", institutionId: instA });
    await createUser({ email: "teacher@pay.dev", password: PW, role: "teacher", institutionId: instA });
    const studentUser = await createUser({ email: "stud@pay.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@pay.dev", password: PW, role: "parent", institutionId: instA });

    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id, guardian_email)
       VALUES ($1,'PAY-1','Asha','K',$2,'asha.guardian@pay.dev') RETURNING id`,
      [instA, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'PAY-2','Bala','M') RETURNING id`,
      [instA]
    );
    st3 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'PAY-3','Chitra','N') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'parent')`,
      [instA, parentUser.id, st2]
    );

    inv1 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1,'PAY-INV1',$2,'Tuition',1000, CURRENT_DATE + 10) RETURNING id`,
      [instA, st1]
    );
    inv2 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1,'PAY-INV2',$2,'Tuition',500, CURRENT_DATE + 10) RETURNING id`,
      [instA, st2]
    );
    inv3 = await insertId(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1,'PAY-INV3',$2,'Tuition',800, CURRENT_DATE + 10) RETURNING id`,
      [instA, st3]
    );

    for (const [k, e] of [
      ["admin", "admin@pay.dev"],
      ["acct", "acct@pay.dev"],
      ["teacher", "teacher@pay.dev"],
      ["stud", "stud@pay.dev"],
      ["parent", "parent@pay.dev"],
    ] as const) {
      tok[k] = await tokenFor(e, PW);
    }
  });

  afterEach(() => disableGateway());

  it("creates a payment order against an invoice", async () => {
    enableGateway();
    const res = await createOrder(tok.admin, inv1);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("created");
    expect(Number(res.body.amount)).toBe(1000);
    expect(res.body.provider).toBe("generic");
    expect(res.body.gatewayRef).toContain("generic_");
    expect(res.body.checkoutUrl).toContain("https://pay.test/checkout");
    expect(res.body.invoiceId).toBe(inv1);
  });

  it("lets a student/parent initiate payment only for their own/linked invoice", async () => {
    enableGateway();
    expect((await createOrder(tok.stud, inv1)).status).toBe(201); // st1 = student's own
    expect((await createOrder(tok.parent, inv2)).status).toBe(201); // st2 = parent's child
  });

  it("denies cross-student payment initiation", async () => {
    enableGateway();
    expect((await createOrder(tok.stud, inv2)).status).toBe(403); // not the student's record
    expect((await createOrder(tok.parent, inv3)).status).toBe(403); // not the parent's child
  });

  it("denies cross-institution access", async () => {
    enableGateway();
    const order = (await createOrder(tok.admin, inv1)).body as Order;

    const instB = await createInstitution("PAY2");
    await createUser({ email: "admin@pay2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@pay2.dev", PW);

    expect((await get(`/api/v1/online-payments/${order.id}`, bAdmin)).status).toBe(404);
    expect((await createOrder(bAdmin, inv1)).status).toBe(404); // invoice not in instB
    expect((await get("/api/v1/online-payments", bAdmin)).body).toHaveLength(0);
  });

  it("blocks payment amount tampering", async () => {
    enableGateway();
    const res = await post("/api/v1/online-payments", tok.admin, { invoiceId: inv1, amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
  });

  it("degrades gracefully when the gateway is not configured (offline still works)", async () => {
    // gateway disabled by default
    const res = await createOrder(tok.admin, inv1);
    expect(res.status).toBe(503);

    // Offline fee collection is unaffected.
    const offline = await post(`/api/v1/fees/invoices/${inv1}/payments`, tok.admin, { amount: 250 });
    expect(offline.status).toBe(200);
    expect(Number(offline.body.amountPaid)).toBe(250);
  });

  it("processes a successful webhook → updates order + invoice, then issues a receipt", async () => {
    enableGateway();
    const order = (await createOrder(tok.admin, inv1)).body as Order;

    const wh = await webhook(order, "success");
    expect(wh.status).toBe(200);
    expect(wh.body.status).toBe("success");

    const fresh = (await get(`/api/v1/online-payments/${order.id}`, tok.admin)).body as Order;
    expect(fresh.status).toBe("success");
    expect(fresh.paymentId).toBeTruthy();

    const invoice = (await get(`/api/v1/fees/invoices/${inv1}`, tok.admin)).body;
    expect(invoice.status).toBe("paid");
    expect(Number(invoice.amountPaid)).toBe(1000);

    // A second order for the same invoice is refused (no duplicate success).
    expect((await createOrder(tok.admin, inv1)).status).toBe(400);

    // Receipt PDF is available after success.
    const pdf = await get(`/api/v1/online-payments/${order.id}/receipt`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("is idempotent for duplicate webhooks (invoice credited once)", async () => {
    enableGateway();
    const order = (await createOrder(tok.admin, inv1)).body as Order;

    const first = await webhook(order, "success", { eventId: "evt_dupe_1" });
    expect(first.body.status).toBe("success");
    const second = await webhook(order, "success", { eventId: "evt_dupe_1" });
    expect(second.body.duplicate).toBe(true);

    const invoice = (await get(`/api/v1/fees/invoices/${inv1}`, tok.admin)).body;
    expect(Number(invoice.amountPaid)).toBe(1000); // not 2000
    expect(invoice.payments).toHaveLength(1);
  });

  it("rejects an invalid webhook signature", async () => {
    enableGateway();
    const order = (await createOrder(tok.admin, inv1)).body as Order;

    const bad = await webhook(order, "success", { sig: "deadbeef" });
    expect(bad.status).toBe(401);

    const fresh = (await get(`/api/v1/online-payments/${order.id}`, tok.admin)).body as Order;
    expect(fresh.status).toBe("created"); // unchanged
    const invoice = (await get(`/api/v1/fees/invoices/${inv1}`, tok.admin)).body;
    expect(Number(invoice.amountPaid)).toBe(0);
  });

  it("handles failed/cancelled webhooks without crediting", async () => {
    enableGateway();
    const o1 = (await createOrder(tok.admin, inv1)).body as Order;
    expect((await webhook(o1, "failed")).body.status).toBe("failed");
    expect((await get(`/api/v1/online-payments/${o1.id}`, tok.admin)).body.status).toBe("failed");

    const o2 = (await createOrder(tok.admin, inv2)).body as Order;
    expect((await webhook(o2, "cancelled")).body.status).toBe("cancelled");

    const invoice = (await get(`/api/v1/fees/invoices/${inv1}`, tok.admin)).body;
    expect(Number(invoice.amountPaid)).toBe(0);
  });

  it("enforces permission checks across roles", async () => {
    enableGateway();
    // teacher has no online_payments permissions at all.
    expect((await get("/api/v1/online-payments", tok.teacher)).status).toBe(403);
    expect((await createOrder(tok.teacher, inv1)).status).toBe(403);

    // settings is admin-only (accountant/student lack it).
    expect((await get("/api/v1/online-payments/settings", tok.admin)).status).toBe(200);
    expect((await get("/api/v1/online-payments/settings", tok.acct)).status).toBe(403);
    expect((await get("/api/v1/online-payments/settings", tok.stud)).status).toBe(403);

    // refund: accountant yes, student/parent no.
    const order = (await createOrder(tok.admin, inv1)).body as Order;
    await webhook(order, "success");
    expect((await post(`/api/v1/online-payments/${order.id}/refund`, tok.stud)).status).toBe(403);
    const refunded = await post(`/api/v1/online-payments/${order.id}/refund`, tok.acct);
    expect(refunded.status).toBe(200);
    expect(refunded.body.status).toBe("refunded");

    // reports: admin can run, teacher cannot.
    expect((await get("/api/v1/report-center/online_payment_transactions", tok.admin)).status).toBe(200);
    expect((await get("/api/v1/report-center/online_payment_transactions", tok.teacher)).status).toBe(403);
  });

  it("never exposes gateway secrets; settings flag toggles enablement", async () => {
    enableGateway();
    const settings = await get("/api/v1/online-payments/settings", tok.admin);
    expect(settings.status).toBe(200);
    expect(settings.body.configured).toBe(true);
    expect(settings.body.provider).toBe("generic");
    expect(JSON.stringify(settings.body)).not.toContain(WH_SECRET);
    expect(JSON.stringify(settings.body).toLowerCase()).not.toContain("secret");

    const order = await createOrder(tok.admin, inv1);
    expect(JSON.stringify(order.body)).not.toContain(WH_SECRET);

    // Disable for the institution via the feature flag → creation is blocked.
    const patched = await request(app)
      .patch("/api/v1/online-payments/settings")
      .set(auth(tok.admin))
      .send({ enabled: false });
    expect(patched.body.enabled).toBe(false);
    expect((await createOrder(tok.admin, inv2)).status).toBe(503);
  });
});
