import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";
import { signPayload } from "../../src/modules/saaspayments/saaspayments.service";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const WH_SECRET = "whsec_test_1234";

describe("super admin C-4: Razorpay payment gateway (platform SaaS invoices)", () => {
  let superToken: string;
  let adminToken: string;
  let instId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    const inst = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Riverdale", code: "RVD", type: "school" });
    instId = inst.body.id;
  });

  const configureGateway = (over: Record<string, unknown> = {}) =>
    request(app)
      .patch("/api/v1/platform/payment-gateway")
      .set(auth(superToken))
      .send({
        enabled: true,
        keyId: "rzp_test_abcdef",
        keySecret: "secret_value_9876",
        webhookSecret: WH_SECRET,
        defaultCurrency: "INR",
        ...over,
      });

  const mkInvoice = async (issue = true, unitPrice = 1000) => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice }], taxPercent: 0 });
    if (issue) {
      const issued = await request(app)
        .post(`/api/v1/platform/invoices/${draft.body.id}/issue`)
        .set(auth(superToken));
      return issued.body;
    }
    return draft.body;
  };

  // Build a signed Razorpay payment_link.paid webhook for an invoice.
  const sendWebhook = (
    invoice: { id: string; number?: string | null; total?: string },
    eventId: string,
    over: { secret?: string; signature?: string; event?: string; notesInvoiceId?: string | null } = {}
  ) => {
    const amountPaise = Math.round(Number(invoice.total ?? 1000) * 100);
    const body = {
      event: over.event ?? "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: `plink_${eventId}`,
            reference_id: invoice.number ?? invoice.id,
            notes: { invoice_id: over.notesInvoiceId === undefined ? invoice.id : over.notesInvoiceId },
            amount: amountPaise,
          },
        },
        payment: { entity: { id: `pay_${eventId}`, amount: amountPaise } },
      },
    };
    const raw = JSON.stringify(body);
    const signature = over.signature ?? signPayload(raw, over.secret ?? WH_SECRET);
    return request(app)
      .post("/api/v1/platform/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .set("x-razorpay-event-id", eventId)
      .send(raw);
  };

  it("gates gateway settings + transactions behind super admin", async () => {
    expect((await request(app).get("/api/v1/platform/payment-gateway").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).patch("/api/v1/platform/payment-gateway").set(auth(adminToken)).send({ enabled: true })).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/payment-transactions").set(auth(adminToken))).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/payment-gateway").set(auth(superToken))).status).toBe(200);
  });

  it("never returns raw secrets — only masked previews + set flags", async () => {
    await configureGateway();
    const res = await request(app).get("/api/v1/platform/payment-gateway").set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.keyId).toBe("rzp_test_abcdef"); // key id is not a secret
    expect(res.body.configured).toBe(true);
    // Secrets are masked, set-flagged, and NEVER present raw.
    expect(res.body.keySecretSet).toBe(true);
    expect(res.body.webhookSecretSet).toBe(true);
    expect(res.body.keySecretMasked).toBe("••••9876");
    expect(res.body.webhookSecretMasked).toBe("••••1234");
    expect(res.body.keySecret).toBeUndefined();
    expect(res.body.webhookSecret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("secret_value_9876");
    expect(JSON.stringify(res.body)).not.toContain(WH_SECRET);
  });

  it("preserves stored secrets when the masked form is saved without re-entering them", async () => {
    await configureGateway();
    // Save again changing only the currency, sending blank secrets.
    const upd = await request(app)
      .patch("/api/v1/platform/payment-gateway")
      .set(auth(superToken))
      .send({ defaultCurrency: "USD", keySecret: "", webhookSecret: "" });
    expect(upd.status).toBe(200);
    expect(upd.body.defaultCurrency).toBe("USD");
    expect(upd.body.keySecretSet).toBe(true); // still set
    expect(upd.body.webhookSecretMasked).toBe("••••1234"); // unchanged
  });

  it("marks an issued invoice paid on a signature-verified webhook + records the transaction", async () => {
    await configureGateway();
    const inv = await mkInvoice(true, 1000);
    expect(inv.status).toBe("issued");

    const res = await sendWebhook(inv, "evt_pay_1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.marked).toBe(true);

    const after = await request(app).get(`/api/v1/platform/invoices/${inv.id}`).set(auth(superToken));
    expect(after.body.status).toBe("paid");
    expect(after.body.paymentMethod).toBe("razorpay");
    expect(after.body.paymentReference).toBe("pay_evt_pay_1");

    const txns = await request(app)
      .get(`/api/v1/platform/payment-transactions?invoiceId=${inv.id}`)
      .set(auth(superToken));
    expect(txns.body.rows.length).toBe(1);
    expect(txns.body.rows[0].status).toBe("paid");
    expect(Number(txns.body.totals.paidAmount)).toBe(1000);
  });

  it("rejects a webhook with a bad signature and does NOT mark the invoice paid", async () => {
    await configureGateway();
    const inv = await mkInvoice(true, 1000);
    const res = await sendWebhook(inv, "evt_bad", { signature: "deadbeef" });
    expect(res.status).toBe(401);
    const after = await request(app).get(`/api/v1/platform/invoices/${inv.id}`).set(auth(superToken));
    expect(after.body.status).toBe("issued"); // unchanged
  });

  it("is idempotent — a duplicate webhook (same event id) does not double-process", async () => {
    await configureGateway();
    const inv = await mkInvoice(true, 1000);
    const first = await sendWebhook(inv, "evt_dup");
    expect(first.body.marked).toBe(true);
    const second = await sendWebhook(inv, "evt_dup");
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const txns = await request(app)
      .get(`/api/v1/platform/payment-transactions?invoiceId=${inv.id}`)
      .set(auth(superToken));
    expect(txns.body.rows.length).toBe(1); // still exactly one transaction
    const events = await query("SELECT count(*)::int AS c FROM saas_payment_webhook_events WHERE event_id = 'evt_dup'");
    expect(events.rows[0].c).toBe(1); // recorded once
  });

  it("ignores a webhook for an unknown invoice (still 200, no crash)", async () => {
    await configureGateway();
    const res = await sendWebhook({ id: "00000000-0000-0000-0000-000000000000", number: "NOPE", total: "500" }, "evt_unknown", {
      notesInvoiceId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
  });

  it("refuses webhooks when the webhook secret is not configured (cannot verify)", async () => {
    // Gateway never configured → no secret → 503.
    const inv = await mkInvoice(true, 1000);
    const res = await sendWebhook(inv, "evt_nosecret");
    expect(res.status).toBe(503);
    const after = await request(app).get(`/api/v1/platform/invoices/${inv.id}`).set(auth(superToken));
    expect(after.body.status).toBe("issued");
  });

  it("the public webhook needs no auth token (signature is the trust boundary)", async () => {
    await configureGateway();
    const inv = await mkInvoice(true, 1000);
    // No Authorization header at all — must still be routed + processed.
    const res = await sendWebhook(inv, "evt_noauth");
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(true);
  });

  it("guards payment-link creation: gateway off, non-issued, already paid", async () => {
    // Gateway disabled → cannot create a link.
    const issued = await mkInvoice(true, 1000);
    const off = await request(app).post(`/api/v1/platform/invoices/${issued.id}/payment-link`).set(auth(superToken));
    expect(off.status).toBe(400);

    await configureGateway();
    // Draft invoice → cannot create a link (must be issued).
    const draft = await mkInvoice(false, 1000);
    const draftLink = await request(app).post(`/api/v1/platform/invoices/${draft.id}/payment-link`).set(auth(superToken));
    expect(draftLink.status).toBe(400);

    // Already-paid invoice → cannot create a link.
    await sendWebhook(issued, "evt_for_paid");
    const paidLink = await request(app).post(`/api/v1/platform/invoices/${issued.id}/payment-link`).set(auth(superToken));
    expect(paidLink.status).toBe(400);
  });

  it("exports the transactions report as CSV", async () => {
    await configureGateway();
    const inv = await mkInvoice(true, 1000);
    await sendWebhook(inv, "evt_export");
    const csv = await request(app).get("/api/v1/platform/payment-transactions?format=csv").set(auth(superToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("csv");
    expect(csv.text).toContain("Gateway payment id");
  });
});
