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
  // The endpoint is paginated: { rows, total, page, pageSize }.
  it("lists all invoices across tenants (paged, empty + populated, with institution join)", async () => {
    // Empty list must succeed (not 500) with an empty page.
    const empty = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(superToken));
    expect(empty.status).toBe(200);
    expect(empty.body.rows).toEqual([]);
    expect(empty.body.total).toBe(0);
    expect(empty.body.page).toBe(1);

    await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 500 }] });

    const list = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.rows[0].institutionName).toBe("Institution INV");
    expect(list.body.rows[0].institutionCode).toBe("INV");
    expect(Number(list.body.rows[0].total)).toBe(500);

    // Status filter also exercises the join.
    const filtered = await request(app)
      .get("/api/v1/platform/invoices?status=draft")
      .set(auth(superToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.rows).toHaveLength(1);

    // A non-matching status filter returns an empty page (not 500).
    const none = await request(app)
      .get("/api/v1/platform/invoices?status=paid")
      .set(auth(superToken));
    expect(none.status).toBe(200);
    expect(none.body.rows).toHaveLength(0);
    expect(none.body.total).toBe(0);

    // Non-super-admin is blocked.
    const denied = await request(app)
      .get("/api/v1/platform/invoices")
      .set(auth(adminToken));
    expect(denied.status).toBe(403);
  });

  it("edits a draft's header and recomputes tax, then removes a line", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({
        taxPercent: 0,
        lines: [
          { description: "Pro plan", quantity: 1, unitPrice: 1000 },
          { description: "Extra seats", quantity: 2, unitPrice: 250 },
        ],
      });
    const invoiceId = draft.body.id;
    const lineId = draft.body.lines[1].id; // "Extra seats"
    expect(Number(draft.body.subtotal)).toBe(1500);
    expect(Number(draft.body.taxAmount)).toBe(0);

    // Edit header: set tax %, currency and billing details — totals recompute.
    const edited = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}`)
      .set(auth(superToken))
      .send({
        taxPercent: 10,
        currency: "USD",
        billingName: "Acme School",
        gstin: "29ABCDE1234F1Z5",
      });
    expect(edited.status).toBe(200);
    expect(edited.body.currency).toBe("USD");
    expect(edited.body.billingName).toBe("Acme School");
    expect(edited.body.gstin).toBe("29ABCDE1234F1Z5");
    expect(Number(edited.body.taxAmount)).toBe(150); // 10% of 1500
    expect(Number(edited.body.total)).toBe(1650);

    // Clearing a nullable field with null works.
    const cleared = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}`)
      .set(auth(superToken))
      .send({ gstin: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.gstin).toBeNull();

    // Empty body is rejected by the schema.
    const empty = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}`)
      .set(auth(superToken))
      .send({});
    expect(empty.status).toBe(400);

    // Remove the "Extra seats" line -> subtotal/tax recompute.
    const removed = await request(app)
      .delete(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken));
    expect(removed.status).toBe(200);
    expect(removed.body.lines).toHaveLength(1);
    expect(Number(removed.body.subtotal)).toBe(1000);
    expect(Number(removed.body.taxAmount)).toBe(100); // 10% of 1000
    expect(Number(removed.body.total)).toBe(1100);

    // Removing an unknown line is a 404.
    const ghost = await request(app)
      .delete(
        `/api/v1/platform/invoices/${invoiceId}/lines/${invoiceId}` // valid uuid, not a line
      )
      .set(auth(superToken));
    expect(ghost.status).toBe(404);
  });

  it("cannot edit or remove lines after a draft is issued", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 500 }] });
    const invoiceId = draft.body.id;
    const lineId = draft.body.lines[0].id;

    await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/issue`)
      .set(auth(superToken));

    const editAfter = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}`)
      .set(auth(superToken))
      .send({ taxPercent: 5 });
    expect(editAfter.status).toBe(400);

    const removeAfter = await request(app)
      .delete(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken));
    expect(removeAfter.status).toBe(400);
  });

  it("blocks non-super-admins from editing drafts and removing lines", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 500 }] });
    const invoiceId = draft.body.id;
    const lineId = draft.body.lines[0].id;

    const edit = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}`)
      .set(auth(adminToken))
      .send({ taxPercent: 5 });
    expect(edit.status).toBe(403);

    const remove = await request(app)
      .delete(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(adminToken));
    expect(remove.status).toBe(403);
  });

  it("edits an individual line item and recomputes, with guards", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({
        taxPercent: 10,
        lines: [
          { description: "Seat", quantity: 1, unitPrice: 100 },
          { description: "Addon", quantity: 1, unitPrice: 50 },
        ],
      });
    const invoiceId = draft.body.id;
    const lineId = draft.body.lines[0].id;

    // Edit qty + unit price -> line amount and totals recompute.
    const edited = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken))
      .send({ quantity: 3, unitPrice: 200 });
    expect(edited.status).toBe(200);
    const line = edited.body.lines.find((l: { id: string }) => l.id === lineId);
    expect(Number(line.amount)).toBe(600); // 3 * 200
    expect(Number(edited.body.subtotal)).toBe(650); // 600 + 50
    expect(Number(edited.body.taxAmount)).toBe(65); // 10% of 650
    expect(Number(edited.body.total)).toBe(715);

    // Edit description only -> amount unchanged.
    const renamed = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken))
      .send({ description: "Renamed seat" });
    expect(renamed.status).toBe(200);
    const r2 = renamed.body.lines.find((l: { id: string }) => l.id === lineId);
    expect(r2.description).toBe("Renamed seat");
    expect(Number(r2.amount)).toBe(600);

    // Unknown line -> 404; empty body -> 400; non-super-admin -> 403.
    const ghost = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${invoiceId}`)
      .set(auth(superToken))
      .send({ quantity: 1 });
    expect(ghost.status).toBe(404);
    const empty = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken))
      .send({});
    expect(empty.status).toBe(400);
    const denied = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(adminToken))
      .send({ quantity: 1 });
    expect(denied.status).toBe(403);

    // After issue, lines can't be edited.
    await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/issue`)
      .set(auth(superToken));
    const late = await request(app)
      .patch(`/api/v1/platform/invoices/${invoiceId}/lines/${lineId}`)
      .set(auth(superToken))
      .send({ quantity: 9 });
    expect(late.status).toBe(400);
  });

  it("deletes a draft, but never an issued invoice", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 1 }] });
    const id = draft.body.id;

    // Non-super-admin can't delete.
    const denied = await request(app)
      .delete(`/api/v1/platform/invoices/${id}`)
      .set(auth(adminToken));
    expect(denied.status).toBe(403);

    // Super-admin deletes the draft; it's then gone (404).
    const del = await request(app)
      .delete(`/api/v1/platform/invoices/${id}`)
      .set(auth(superToken));
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    const gone = await request(app)
      .get(`/api/v1/platform/invoices/${id}`)
      .set(auth(superToken));
    expect(gone.status).toBe(404);

    // An issued invoice cannot be deleted.
    const d2 = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "y", unitPrice: 1 }] });
    await request(app)
      .post(`/api/v1/platform/invoices/${d2.body.id}/issue`)
      .set(auth(superToken));
    const delIssued = await request(app)
      .delete(`/api/v1/platform/invoices/${d2.body.id}`)
      .set(auth(superToken));
    expect(delIssued.status).toBe(400);
  });

  it("duplicates any invoice into a fresh draft (header + lines copied)", async () => {
    const src = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({
        taxPercent: 18,
        billingName: "Acme School",
        paymentTermsDays: 15,
        lines: [
          { description: "Pro", quantity: 1, unitPrice: 1000 },
          { description: "Seats", quantity: 2, unitPrice: 250 },
        ],
      });
    const srcId = src.body.id;
    await request(app)
      .post(`/api/v1/platform/invoices/${srcId}/issue`)
      .set(auth(superToken));

    const dup = await request(app)
      .post(`/api/v1/platform/invoices/${srcId}/duplicate`)
      .set(auth(superToken));
    expect(dup.status).toBe(201);
    expect(dup.body.status).toBe("draft");
    expect(dup.body.number).toBeNull();
    expect(dup.body.dueDate).toBeNull();
    expect(dup.body.billingName).toBe("Acme School");
    expect(dup.body.paymentTermsDays).toBe(15);
    expect(dup.body.lines).toHaveLength(2);
    expect(Number(dup.body.subtotal)).toBe(1500);
    expect(Number(dup.body.total)).toBe(1770);

    // The original remains issued and untouched.
    const original = await request(app)
      .get(`/api/v1/platform/invoices/${srcId}`)
      .set(auth(superToken));
    expect(original.body.status).toBe("issued");
  });

  it("re-sends issued/paid invoices but not drafts", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 1 }] });
    const id = draft.body.id;

    // Draft can't be re-sent.
    const tooEarly = await request(app)
      .post(`/api/v1/platform/invoices/${id}/resend`)
      .set(auth(superToken));
    expect(tooEarly.status).toBe(400);

    await request(app)
      .post(`/api/v1/platform/invoices/${id}/issue`)
      .set(auth(superToken));
    const resent = await request(app)
      .post(`/api/v1/platform/invoices/${id}/resend`)
      .set(auth(superToken));
    expect(resent.status).toBe(200);
    expect(typeof resent.body.recipients).toBe("number");

    // Non-super-admin is blocked.
    const denied = await request(app)
      .post(`/api/v1/platform/invoices/${id}/resend`)
      .set(auth(adminToken));
    expect(denied.status).toBe(403);
  });

  it("sets the due date on issue (payment terms or explicit) and flags overdue", async () => {
    // Payment terms -> due date computed on issue; not overdue.
    const d1 = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ paymentTermsDays: 15, lines: [{ description: "x", unitPrice: 100 }] });
    const i1 = await request(app)
      .post(`/api/v1/platform/invoices/${d1.body.id}/issue`)
      .set(auth(superToken));
    expect(i1.body.dueDate).toBeTruthy();
    expect(i1.body.isOverdue).toBe(false);

    // Explicit past due date -> overdue once issued.
    const d2 = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ dueDate: "2020-01-01", lines: [{ description: "y", unitPrice: 200 }] });
    const i2 = await request(app)
      .post(`/api/v1/platform/invoices/${d2.body.id}/issue`)
      .set(auth(superToken));
    expect(i2.body.dueDate).toBe("2020-01-01");
    expect(i2.body.isOverdue).toBe(true);

    // Overdue filter returns only the overdue invoice.
    const overdue = await request(app)
      .get("/api/v1/platform/invoices?overdue=true")
      .set(auth(superToken));
    expect(overdue.body.rows).toHaveLength(1);
    expect(overdue.body.rows[0].id).toBe(i2.body.id);

    // Summary reflects the two issued invoices and one overdue.
    const sum = await request(app)
      .get("/api/v1/platform/invoices/summary")
      .set(auth(superToken));
    expect(sum.status).toBe(200);
    expect(sum.body.issuedCount).toBe(2);
    expect(sum.body.overdueCount).toBe(1);
    expect(Number(sum.body.overdueAmount)).toBe(200);
    expect(Number(sum.body.outstandingAmount)).toBe(300); // 100 + 200
  });

  it("paginates and filters the global list", async () => {
    const inst2 = await createInstitution("IN2");
    await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "a", unitPrice: 10 }] });
    await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "b", unitPrice: 20 }] });
    await request(app)
      .post(`/api/v1/platform/institutions/${inst2}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "c", unitPrice: 30 }] });

    // Page 1 of 2 per page -> 2 rows, total 3.
    const p1 = await request(app)
      .get("/api/v1/platform/invoices?pageSize=2&page=1")
      .set(auth(superToken));
    expect(p1.body.total).toBe(3);
    expect(p1.body.rows).toHaveLength(2);
    // Page 2 -> the remaining 1 row.
    const p2 = await request(app)
      .get("/api/v1/platform/invoices?pageSize=2&page=2")
      .set(auth(superToken));
    expect(p2.body.rows).toHaveLength(1);

    // Institution filter.
    const byInst = await request(app)
      .get(`/api/v1/platform/invoices?institutionId=${inst2}`)
      .set(auth(superToken));
    expect(byInst.body.total).toBe(1);
    expect(byInst.body.rows[0].institutionCode).toBe("IN2");

    // Search by institution code.
    const search = await request(app)
      .get("/api/v1/platform/invoices?q=IN2")
      .set(auth(superToken));
    expect(search.body.total).toBe(1);
  });
});
