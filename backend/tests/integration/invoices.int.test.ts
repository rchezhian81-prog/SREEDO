import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("billing B2: gateway-free SaaS invoicing", () => {
  let superToken: string;
  let adminToken: string;
  let instId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    instId = await createInstitution("INV");
  });

  it("blocks non-super-admins", async () => {
    const res = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(adminToken))
      .send({ lines: [{ description: "Plan", unitPrice: 100 }] });
    expect(res.status).toBe(403);
  });

  it("drafts, computes tax, issues with a number, and records offline payment", async () => {
    // Draft with two lines + 18% tax.
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({
        taxPercent: 18,
        notes: "Annual subscription",
        gstin: "29ABCDE1234F1Z5",
        billingName: "Greenwood High",
        billingAddress: "12 River Rd",
        lines: [
          { description: "Pro plan", quantity: 1, unitPrice: 1000 },
          { description: "Extra seats", quantity: 2, unitPrice: 250 },
        ],
      });
    expect(draft.status).toBe(201);
    expect(draft.body.status).toBe("draft");
    expect(draft.body.number).toBeNull();
    expect(draft.body.gstin).toBe("29ABCDE1234F1Z5");
    expect(draft.body.billingName).toBe("Greenwood High");
    expect(Number(draft.body.subtotal)).toBe(1500); // 1000 + 2*250
    expect(Number(draft.body.taxAmount)).toBe(270); // 18% of 1500
    expect(Number(draft.body.total)).toBe(1770);
    expect(draft.body.lines).toHaveLength(2);
    const invoiceId = draft.body.id;

    // Issue -> assigns a financial-year-segmented number + status issued.
    const issued = await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/issue`)
      .set(auth(superToken));
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe("issued");
    expect(issued.body.number).toMatch(/^SINV-FY\d{4}-\d{2}-\d{6}$/);
    expect(issued.body.issuedAt).toBeTruthy();

    // Can't add lines after issue.
    const lateLine = await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/lines`)
      .set(auth(superToken))
      .send({ description: "late", unitPrice: 10 });
    expect(lateLine.status).toBe(400);

    // PDF download works on an issued invoice.
    const pdf = await request(app)
      .get(`/api/v1/platform/invoices/${invoiceId}/pdf`)
      .set(auth(superToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");

    // Mark paid (offline) with a reference.
    const paid = await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/mark-paid`)
      .set(auth(superToken))
      .send({ paymentMethod: "bank_transfer", reference: "NEFT-12345" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("paid");
    expect(paid.body.paymentMethod).toBe("bank_transfer");
    expect(paid.body.paymentReference).toBe("NEFT-12345");
    expect(paid.body.paidAt).toBeTruthy();

    // A paid invoice cannot be voided.
    const badVoid = await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/void`)
      .set(auth(superToken));
    expect(badVoid.status).toBe(400);

    // Tenant list shows the invoice.
    const list = await request(app)
      .get(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe("paid");
  });

  it("issues sequential numbers and voids a draft", async () => {
    const mk = async () => {
      const d = await request(app)
        .post(`/api/v1/platform/institutions/${instId}/invoices`)
        .set(auth(superToken))
        .send({ lines: [{ description: "x", unitPrice: 1 }] });
      const i = await request(app)
        .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
        .set(auth(superToken));
      return i.body.number as string;
    };
    const n1 = await mk();
    const n2 = await mk();
    expect(n1).not.toBe(n2);

    // A fresh draft can be voided.
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({});
    const voided = await request(app)
      .post(`/api/v1/platform/invoices/${draft.body.id}/void`)
      .set(auth(superToken));
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe("void");
  });

  // Regression: GET /platform/invoices joins institutions, so the shared column
  // list must be table-qualified or Postgres errors on ambiguous id/created_at.
  it("lists all invoices across tenants (empty + populated, with institution join)", async () => {
    // Empty list must succeed (not 500) and return [].
    const empty = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(superToken));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 500 }] });

    const list = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].institutionName).toBe("Institution INV");
    expect(list.body[0].institutionCode).toBe("INV");
    expect(Number(list.body[0].total)).toBe(500);

    // Status filter also exercises the join.
    const filtered = await request(app)
      .get("/api/v1/platform/invoices?status=draft")
      .set(auth(superToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body).toHaveLength(1);

    // Non-super-admin is blocked.
    const denied = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(adminToken));
    expect(denied.status).toBe(403);
  });
});
