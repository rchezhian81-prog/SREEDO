import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("super admin C-2: coupons + invoice discount", () => {
  let superToken: string;
  let adminToken: string;
  let instId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    const inst = await request(app).post("/api/v1/institutions").set(auth(superToken)).send({ name: "Riverdale", code: "RVD", type: "school" });
    instId = inst.body.id;
  });

  const mkCoupon = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/platform/coupons").set(auth(superToken)).send(body);
  const mkDraft = (taxPercent = 18, unitPrice = 1000) =>
    request(app).post(`/api/v1/platform/institutions/${instId}/invoices`).set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice }], taxPercent });
  const apply = (id: string, code: string) =>
    request(app).post(`/api/v1/platform/invoices/${id}/coupon`).set(auth(superToken)).send({ code });

  it("blocks non-super-admins", async () => {
    expect((await request(app).get("/api/v1/platform/coupons").set(auth(adminToken))).status).toBe(403);
    expect((await mkCoupon({ code: "XX", discountType: "fixed", discountValue: 10 })).status).toBe(201); // super ok
    expect((await request(app).post("/api/v1/platform/coupons").set(auth(adminToken)).send({ code: "YY", discountType: "fixed", discountValue: 1 })).status).toBe(403);
  });

  it("creates, validates and lists coupons", async () => {
    const c = await mkCoupon({ code: "save10", name: "10% off", discountType: "percentage", discountValue: 10, status: "active" });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe("SAVE10"); // normalised to upper-case
    expect((await mkCoupon({ code: "BAD", discountType: "percentage", discountValue: 150 })).status).toBe(400); // > 100%
    expect((await mkCoupon({ code: "SAVE10", discountType: "fixed", discountValue: 5 })).status).toBe(409); // duplicate code
    const list = await request(app).get("/api/v1/platform/coupons?status=active").set(auth(superToken));
    expect(list.body.map((x: { code: string }) => x.code)).toContain("SAVE10");
  });

  it("applies a percentage coupon PRE-TAX to a draft and recomputes the total", async () => {
    await mkCoupon({ code: "TEN", discountType: "percentage", discountValue: 10, status: "active" });
    const draft = await mkDraft(18, 1000);
    expect(Number(draft.body.subtotal)).toBe(1000);
    expect(Number(draft.body.total)).toBe(1180);
    const applied = await apply(draft.body.id, "TEN");
    expect(applied.status).toBe(200);
    expect(Number(applied.body.discountAmount)).toBe(100); // 10% of 1000
    expect(Number(applied.body.taxAmount)).toBe(162); // 18% of (1000-100)
    expect(Number(applied.body.total)).toBe(1062); // 900 + 162
  });

  it("caps the discount at the subtotal (total never below zero)", async () => {
    await mkCoupon({ code: "BIG", discountType: "fixed", discountValue: 99999, status: "active" });
    const draft = await mkDraft(0, 500);
    const applied = await apply(draft.body.id, "BIG");
    expect(Number(applied.body.discountAmount)).toBe(500);
    expect(Number(applied.body.total)).toBe(0);
  });

  it("rejects inactive coupons and enforces the minimum invoice amount", async () => {
    await mkCoupon({ code: "DRAFTC", discountType: "fixed", discountValue: 50, status: "draft" });
    const d1 = await mkDraft();
    expect((await apply(d1.body.id, "DRAFTC")).status).toBe(400); // not active
    await mkCoupon({ code: "MIN", discountType: "fixed", discountValue: 50, status: "active", minInvoiceAmount: 5000 });
    expect((await apply(d1.body.id, "MIN")).status).toBe(400); // subtotal 1000 < 5000
  });

  it("cannot apply to an issued invoice; the issued invoice preserves the discount; usage is tracked", async () => {
    const c = await mkCoupon({ code: "FIVE", discountType: "fixed", discountValue: 50, status: "active" });
    const draft = await mkDraft(0, 1000);
    await apply(draft.body.id, "FIVE");
    const issued = await request(app).post(`/api/v1/platform/invoices/${draft.body.id}/issue`).set(auth(superToken));
    expect(issued.status).toBe(200);
    expect(Number(issued.body.discountAmount)).toBe(50);
    expect(Number(issued.body.total)).toBe(950);
    expect((await apply(draft.body.id, "FIVE")).status).toBe(400); // issued, not a draft

    const usage = await request(app).get(`/api/v1/platform/coupons/${c.body.id}/usage`).set(auth(superToken));
    expect(usage.body.used).toBe(1);
    expect(Number(usage.body.totalDiscount)).toBe(50);
  });

  it("enforces the total usage limit", async () => {
    await mkCoupon({ code: "ONCE", discountType: "fixed", discountValue: 10, status: "active", totalUsageLimit: 1 });
    const d1 = await mkDraft(0, 1000);
    await apply(d1.body.id, "ONCE");
    await request(app).post(`/api/v1/platform/invoices/${d1.body.id}/issue`).set(auth(superToken)); // 1 redemption
    const d2 = await mkDraft(0, 1000);
    expect((await apply(d2.body.id, "ONCE")).status).toBe(400); // limit reached
  });

  it("removes a coupon and restores totals; coupon + apply are audited", async () => {
    await mkCoupon({ code: "REMV", discountType: "fixed", discountValue: 100, status: "active" });
    const draft = await mkDraft(0, 1000);
    await apply(draft.body.id, "REMV");
    const removed = await request(app).delete(`/api/v1/platform/invoices/${draft.body.id}/coupon`).set(auth(superToken));
    expect(Number(removed.body.discountAmount)).toBe(0);
    expect(Number(removed.body.total)).toBe(1000);
    const audit = await query("SELECT action FROM platform_audit_log WHERE action IN ('coupon.created','invoice.coupon_applied')");
    const actions = audit.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("coupon.created");
    expect(actions).toContain("invoice.coupon_applied");
  });

  it("exports the coupon usage report", async () => {
    await mkCoupon({ code: "RPT", discountType: "fixed", discountValue: 10, status: "active" });
    const csv = await request(app).get("/api/v1/platform/coupons-usage-report?format=csv").set(auth(superToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("csv");
  });

  it("does not change the existing no-coupon invoice flow", async () => {
    const draft = await mkDraft(18, 1000);
    expect(Number(draft.body.discountAmount)).toBe(0);
    expect(Number(draft.body.total)).toBe(1180);
    const issued = await request(app).post(`/api/v1/platform/invoices/${draft.body.id}/issue`).set(auth(superToken));
    expect(issued.status).toBe(200);
    expect(Number(issued.body.total)).toBe(1180);
  });
});
