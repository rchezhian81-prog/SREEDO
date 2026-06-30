import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("super admin C-3: GST engine (CGST/SGST/IGST split)", () => {
  let superToken: string;
  let instId: string;

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    const inst = await request(app)
      .post("/api/v1/institutions")
      .set(auth(superToken))
      .send({ name: "Riverdale", code: "RVD", type: "school" });
    instId = inst.body.id;
    // Supplier is in state 33 (Tamil Nadu). invoice_settings is a singleton that
    // persists across resetDb, so set it explicitly for every test.
    await setSupplierState("Tamil Nadu", "33");
  });

  const setSupplierState = (state: string | null, code: string | null) =>
    request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ supplierState: state, supplierStateCode: code });

  // recipientStateCode controls the split: same as supplier => intra (CGST/SGST),
  // different => inter (IGST), absent => legacy single tax bucket.
  const mkDraft = (body: Record<string, unknown> = {}) => {
    const { unitPrice = 1000, ...rest } = body;
    return request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ taxPercent: 18, ...rest, lines: [{ description: "Plan", unitPrice }] });
  };

  const issue = (id: string) =>
    request(app).post(`/api/v1/platform/invoices/${id}/issue`).set(auth(superToken));
  const getInvoice = (id: string) =>
    request(app).get(`/api/v1/platform/invoices/${id}`).set(auth(superToken));

  it("splits intra-state tax into CGST + SGST", async () => {
    const draft = await mkDraft({ recipientStateCode: "33", taxPercent: 18 });
    expect(draft.status).toBe(201);
    expect(Number(draft.body.subtotal)).toBe(1000);
    expect(Number(draft.body.cgstRate)).toBe(9);
    expect(Number(draft.body.sgstRate)).toBe(9);
    expect(Number(draft.body.cgstAmount)).toBe(90);
    expect(Number(draft.body.sgstAmount)).toBe(90);
    expect(Number(draft.body.igstAmount)).toBe(0);
    expect(Number(draft.body.taxAmount)).toBe(180); // 90 + 90
    expect(Number(draft.body.total)).toBe(1180);
  });

  it("uses IGST for inter-state supply", async () => {
    const draft = await mkDraft({ recipientStateCode: "27", taxPercent: 18 }); // Maharashtra
    expect(Number(draft.body.cgstAmount)).toBe(0);
    expect(Number(draft.body.sgstAmount)).toBe(0);
    expect(Number(draft.body.igstRate)).toBe(18);
    expect(Number(draft.body.igstAmount)).toBe(180);
    expect(Number(draft.body.taxAmount)).toBe(180);
    expect(Number(draft.body.total)).toBe(1180);
  });

  it("shows GST under reverse charge but does not collect it (tax not added to total)", async () => {
    const draft = await mkDraft({ recipientStateCode: "33", reverseCharge: true, taxPercent: 18 });
    // The split is still computed/shown for reference...
    expect(Number(draft.body.cgstAmount)).toBe(90);
    expect(Number(draft.body.sgstAmount)).toBe(90);
    expect(draft.body.reverseCharge).toBe(true);
    // ...but it is the recipient's liability, so the supplier does not collect it.
    expect(Number(draft.body.taxAmount)).toBe(0);
    expect(Number(draft.body.total)).toBe(1000); // subtotal only, no tax added
  });

  it("freezes the GST split on issue; later supplier-state changes don't alter it", async () => {
    const draft = await mkDraft({ recipientStateCode: "33", taxPercent: 18 });
    const issued = await issue(draft.body.id);
    expect(issued.status).toBe(200);
    expect(Number(issued.body.cgstAmount)).toBe(90);
    expect(Number(issued.body.sgstAmount)).toBe(90);
    expect(issued.body.supplierStateCode).toBe("33"); // snapshot on the invoice

    // Change the supplier's state AFTER issue. The issued invoice is never
    // recomputed, so its frozen split must be unchanged.
    await setSupplierState("Maharashtra", "27");
    const after = await getInvoice(draft.body.id);
    expect(Number(after.body.cgstAmount)).toBe(90);
    expect(Number(after.body.sgstAmount)).toBe(90);
    expect(Number(after.body.igstAmount)).toBe(0);
    expect(after.body.supplierStateCode).toBe("33");
    expect(Number(after.body.total)).toBe(1180);
  });

  it("falls back to a single tax bucket when state is unknown (legacy, unchanged)", async () => {
    await setSupplierState(null, null); // clear supplier state
    const draft = await mkDraft({ taxPercent: 18 }); // no recipient state either
    expect(Number(draft.body.cgstAmount)).toBe(0);
    expect(Number(draft.body.sgstAmount)).toBe(0);
    expect(Number(draft.body.igstAmount)).toBe(0);
    expect(Number(draft.body.taxAmount)).toBe(180); // single 18% bucket
    expect(Number(draft.body.total)).toBe(1180); // byte-identical to pre-GST behaviour
  });

  it("treats a known supplier with no recipient state as legacy (single bucket)", async () => {
    // Supplier 33 is set, but no recipient => cannot determine intra/inter => legacy.
    const draft = await mkDraft({ taxPercent: 18 });
    expect(Number(draft.body.cgstAmount)).toBe(0);
    expect(Number(draft.body.igstAmount)).toBe(0);
    expect(Number(draft.body.taxAmount)).toBe(180);
    expect(Number(draft.body.total)).toBe(1180);
  });

  it("produces a GST summary report (CGST/SGST/IGST) over issued invoices", async () => {
    const intra = await mkDraft({ recipientStateCode: "33", taxPercent: 18 });
    await issue(intra.body.id);
    const inter = await mkDraft({ recipientStateCode: "27", taxPercent: 18 });
    await issue(inter.body.id);
    // A reverse-charge invoice's tax is the recipient's liability and is excluded.
    const rcm = await mkDraft({ recipientStateCode: "33", reverseCharge: true, taxPercent: 18 });
    await issue(rcm.body.id);

    const rep = await request(app)
      .get("/api/v1/platform/invoices/reports?type=gst")
      .set(auth(superToken));
    expect(rep.status).toBe(200);
    expect(rep.body.type).toBe("gst");
    expect(Number(rep.body.totals.cgstAmount)).toBe(90); // only the intra invoice
    expect(Number(rep.body.totals.sgstAmount)).toBe(90);
    expect(Number(rep.body.totals.igstAmount)).toBe(180); // only the inter invoice
    expect(Number(rep.body.totals.taxAmount)).toBe(360); // 180 intra + 180 inter (RCM excluded)
    // Taxable value spans all three issued invoices (3 × 1000).
    expect(Number(rep.body.totals.taxableValue)).toBe(3000);
  });

  it("includes CGST/SGST/IGST columns in the invoice export", async () => {
    const intra = await mkDraft({ recipientStateCode: "33", taxPercent: 18 });
    await issue(intra.body.id);
    const csv = await request(app)
      .get("/api/v1/platform/invoices/export?format=csv")
      .set(auth(superToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("csv");
    expect(csv.text).toContain("CGST amount");
    expect(csv.text).toContain("SGST amount");
    expect(csv.text).toContain("IGST amount");
  });

  it("persists the GST treatment on a draft", async () => {
    const draft = await mkDraft({ recipientStateCode: "33", gstTreatment: "sez" });
    expect(draft.body.gstTreatment).toBe("sez");
    const patched = await request(app)
      .patch(`/api/v1/platform/invoices/${draft.body.id}`)
      .set(auth(superToken))
      .send({ gstTreatment: "export" });
    expect(patched.status).toBe(200);
    expect(patched.body.gstTreatment).toBe("export");
  });

  it("the GST split is audited-safe: issued invoice GST cannot be edited", async () => {
    const draft = await mkDraft({ recipientStateCode: "33", taxPercent: 18 });
    await issue(draft.body.id);
    // Editing an issued invoice's header is rejected (draft-only guard).
    const patched = await request(app)
      .patch(`/api/v1/platform/invoices/${draft.body.id}`)
      .set(auth(superToken))
      .send({ recipientStateCode: "27" });
    expect(patched.status).toBe(400);
    const after = await getInvoice(draft.body.id);
    expect(Number(after.body.cgstAmount)).toBe(90); // unchanged
  });
});
