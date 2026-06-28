import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const trailing = (num: string) => Number((num.match(/(\d+)$/) || [])[1]);

describe("billing P2: credit & debit notes", () => {
  let superToken: string;
  let adminToken: string;
  let instId: string;

  /** Create + issue an invoice, returning its id. */
  async function issuedInvoice(): Promise<string> {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ taxPercent: 18, lines: [{ description: "Plan", unitPrice: 1000 }] });
    const i = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));
    expect(i.status).toBe(200);
    return d.body.id as string;
  }

  /** Create a draft note (default credit) against an invoice. */
  async function draftNote(
    invoiceId: string,
    body: Record<string, unknown> = { kind: "credit" }
  ) {
    return request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/notes`)
      .set(auth(superToken))
      .send(body);
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    instId = await createInstitution("INV");
  });

  it("blocks non-super-admins from creating notes", async () => {
    const invoiceId = await issuedInvoice();
    const res = await request(app)
      .post(`/api/v1/platform/invoices/${invoiceId}/notes`)
      .set(auth(adminToken))
      .send({ kind: "credit" });
    expect(res.status).toBe(403);
  });

  it("refuses a note against a draft invoice (only issued/paid)", async () => {
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 100 }] });
    const res = await draftNote(draft.body.id);
    expect(res.status).toBe(400);
  });

  it("drafts a credit note, computes tax, edits and removes lines", async () => {
    const invoiceId = await issuedInvoice();
    const note = await draftNote(invoiceId, {
      kind: "credit",
      taxPercent: 18,
      reason: "Service downtime refund",
      lines: [
        { description: "Refund", quantity: 1, unitPrice: 500 },
        { description: "Goodwill", quantity: 2, unitPrice: 100 },
      ],
    });
    expect(note.status).toBe(201);
    expect(note.body.kind).toBe("credit");
    expect(note.body.status).toBe("draft");
    expect(note.body.number).toBeNull();
    expect(note.body.invoiceId).toBe(invoiceId);
    expect(Number(note.body.subtotal)).toBe(700); // 500 + 2*100
    expect(Number(note.body.taxAmount)).toBe(126); // 18% of 700
    expect(Number(note.body.total)).toBe(826);
    expect(note.body.lines).toHaveLength(2);
    const noteId = note.body.id;
    const lineId = note.body.lines[0].id;

    // Edit a line → totals recompute.
    const edited = await request(app)
      .patch(`/api/v1/platform/notes/${noteId}/lines/${lineId}`)
      .set(auth(superToken))
      .send({ unitPrice: 600 });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.subtotal)).toBe(800); // 600 + 200

    // Remove a line → totals recompute.
    const removed = await request(app)
      .delete(`/api/v1/platform/notes/${noteId}/lines/${note.body.lines[1].id}`)
      .set(auth(superToken));
    expect(removed.status).toBe(200);
    expect(Number(removed.body.subtotal)).toBe(600);

    // Header edit (draft only).
    const patched = await request(app)
      .patch(`/api/v1/platform/notes/${noteId}`)
      .set(auth(superToken))
      .send({ reason: "Updated reason", taxPercent: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.reason).toBe("Updated reason");
    expect(Number(patched.body.taxAmount)).toBe(0);
  });

  it("issues credit and debit notes as independent continuous series", async () => {
    const invoiceId = await issuedInvoice();

    const issue = async (kind: "credit" | "debit") => {
      const n = await draftNote(invoiceId, {
        kind,
        lines: [{ description: "x", unitPrice: 10 }],
      });
      const i = await request(app)
        .post(`/api/v1/platform/notes/${n.body.id}/issue`)
        .set(auth(superToken));
      expect(i.status).toBe(200);
      return i.body;
    };

    const c1 = await issue("credit");
    const c2 = await issue("credit");
    const d1 = await issue("debit");

    expect(c1.number).toMatch(/^CN-FY\d{4}-\d{2}-\d{6}$/);
    expect(d1.number).toMatch(/^DN-FY\d{4}-\d{2}-\d{6}$/);
    expect(c1.status).toBe("issued");
    expect(c1.issuedAt).toBeTruthy();
    // Credit series is continuous and independent of the debit series.
    expect(trailing(c2.number)).toBe(trailing(c1.number) + 1);
    expect(trailing(d1.number)).toBe(trailing(c1.number)); // both start at 1
  });

  it("freezes an issued note (no further line/header edits)", async () => {
    const invoiceId = await issuedInvoice();
    const n = await draftNote(invoiceId, {
      kind: "debit",
      lines: [{ description: "x", unitPrice: 10 }],
    });
    await request(app).post(`/api/v1/platform/notes/${n.body.id}/issue`).set(auth(superToken));

    const lateLine = await request(app)
      .post(`/api/v1/platform/notes/${n.body.id}/lines`)
      .set(auth(superToken))
      .send({ description: "late", unitPrice: 5 });
    expect(lateLine.status).toBe(400);

    const lateEdit = await request(app)
      .patch(`/api/v1/platform/notes/${n.body.id}`)
      .set(auth(superToken))
      .send({ reason: "nope" });
    expect(lateEdit.status).toBe(400);

    const lateDelete = await request(app)
      .delete(`/api/v1/platform/notes/${n.body.id}`)
      .set(auth(superToken));
    expect(lateDelete.status).toBe(400);
  });

  it("voids a note with a required reason and records audit", async () => {
    const invoiceId = await issuedInvoice();
    const n = await draftNote(invoiceId, {
      kind: "credit",
      lines: [{ description: "x", unitPrice: 10 }],
    });
    await request(app).post(`/api/v1/platform/notes/${n.body.id}/issue`).set(auth(superToken));

    // Void requires a reason.
    const noReason = await request(app)
      .post(`/api/v1/platform/notes/${n.body.id}/void`)
      .set(auth(superToken))
      .send({});
    expect(noReason.status).toBe(400);

    const voided = await request(app)
      .post(`/api/v1/platform/notes/${n.body.id}/void`)
      .set(auth(superToken))
      .send({ reason: "Issued in error" });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe("void");
    expect(voided.body.voidReason).toBe("Issued in error");

    // Audit timeline records issue + void.
    const audit = await request(app)
      .get(`/api/v1/platform/notes/${n.body.id}/audit`)
      .set(auth(superToken));
    expect(audit.status).toBe(200);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toContain("note.issued");
    expect(actions).toContain("note.voided");
  });

  it("deletes a draft note and lists notes for an invoice", async () => {
    const invoiceId = await issuedInvoice();
    const keep = await draftNote(invoiceId, { kind: "credit" });
    const drop = await draftNote(invoiceId, { kind: "debit" });

    const del = await request(app)
      .delete(`/api/v1/platform/notes/${drop.body.id}`)
      .set(auth(superToken));
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/v1/platform/invoices/${invoiceId}/notes`)
      .set(auth(superToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(keep.body.id);

    // Filter by kind.
    const credits = await request(app)
      .get(`/api/v1/platform/invoices/${invoiceId}/notes?kind=debit`)
      .set(auth(superToken));
    expect(credits.body).toHaveLength(0);
  });

  it("downloads an issued note as a PDF", async () => {
    const invoiceId = await issuedInvoice();
    const n = await draftNote(invoiceId, {
      kind: "credit",
      lines: [{ description: "Refund", unitPrice: 100 }],
    });
    await request(app).post(`/api/v1/platform/notes/${n.body.id}/issue`).set(auth(superToken));

    const pdf = await request(app)
      .get(`/api/v1/platform/notes/${n.body.id}/pdf`)
      .set(auth(superToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.length).toBeGreaterThan(500);
  });

  it("lets the operator set the next note number; rejects below highest issued", async () => {
    const invoiceId = await issuedInvoice();

    const seed = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextCreditNoteNumber: 4000 });
    expect(seed.status).toBe(200);
    expect(seed.body.nextCreditNoteNumber).toBe(4000);

    const n = await draftNote(invoiceId, {
      kind: "credit",
      lines: [{ description: "x", unitPrice: 1 }],
    });
    const issued = await request(app)
      .post(`/api/v1/platform/notes/${n.body.id}/issue`)
      .set(auth(superToken));
    expect(trailing(issued.body.number)).toBe(4000);
    expect(issued.body.number.endsWith("004000")).toBe(true);

    // Below the highest already-issued credit number is rejected.
    const tooLow = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextCreditNoteNumber: 5 });
    expect(tooLow.status).toBe(400);

    // The debit series is independent — still settable low.
    const okDebit = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextDebitNoteNumber: 10 });
    expect(okDebit.status).toBe(200);
    expect(okDebit.body.nextDebitNoteNumber).toBe(10);
  });
});
