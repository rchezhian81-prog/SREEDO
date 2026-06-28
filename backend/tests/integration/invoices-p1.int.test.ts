import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const binary = (res: import("http").IncomingMessage, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("billing P1: reports, exports, advanced search", () => {
  let superToken: string;
  let adminToken: string;
  let instA: string;
  let instB: string;

  // Create an invoice and drive it to a target status.
  async function mk(opts: {
    inst?: string;
    unitPrice: number;
    status?: "draft" | "issued" | "paid" | "void";
    taxPercent?: number;
    sacCode?: string;
    gstin?: string;
    reverseCharge?: boolean;
    recipientState?: string;
    placeOfSupply?: string;
    dueDate?: string;
  }) {
    const inst = opts.inst ?? instA;
    const draft = await request(app)
      .post(`/api/v1/platform/institutions/${inst}/invoices`)
      .set(auth(superToken))
      .send({
        taxPercent: opts.taxPercent ?? 0,
        sacCode: opts.sacCode,
        gstin: opts.gstin,
        reverseCharge: opts.reverseCharge,
        recipientState: opts.recipientState,
        placeOfSupply: opts.placeOfSupply,
        dueDate: opts.dueDate,
        lines: [{ description: "x", unitPrice: opts.unitPrice }],
      });
    const id = draft.body.id;
    const target = opts.status ?? "draft";
    if (target === "draft") return id;
    if (target === "void") {
      await request(app).post(`/api/v1/platform/invoices/${id}/void`).set(auth(superToken)).send({ reason: "test" });
      return id;
    }
    await request(app).post(`/api/v1/platform/invoices/${id}/issue`).set(auth(superToken));
    if (target === "paid") {
      await request(app).post(`/api/v1/platform/invoices/${id}/mark-paid`).set(auth(superToken)).send({ paymentMethod: "cash" });
    }
    return id;
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    instA = await createInstitution("INA");
    instB = await createInstitution("INB");
  });

  it("computes report totals and respects status filters (incl. void inclusion)", async () => {
    await mk({ unitPrice: 1000, taxPercent: 10, status: "paid" }); // total 1100
    await mk({ unitPrice: 2000, taxPercent: 10, status: "issued" }); // total 2200 (outstanding)
    await mk({ unitPrice: 500, status: "draft" }); // total 500
    await mk({ unitPrice: 9999, status: "void" }); // void

    // "all" includes everything; totals add up.
    const all = await request(app).get("/api/v1/platform/invoices/reports?type=all").set(auth(superToken));
    expect(all.status).toBe(200);
    expect(all.body.totals.count).toBe(4);
    expect(Number(all.body.totals.total)).toBe(1100 + 2200 + 500 + 9999);
    expect(Number(all.body.totals.paid)).toBe(1100);
    expect(Number(all.body.totals.issued)).toBe(2200);

    // status reports
    const paid = await request(app).get("/api/v1/platform/invoices/reports?type=paid").set(auth(superToken));
    expect(paid.body.rows).toHaveLength(1);
    expect(Number(paid.body.totals.total)).toBe(1100);

    const unpaid = await request(app).get("/api/v1/platform/invoices/reports?type=unpaid").set(auth(superToken));
    expect(unpaid.body.rows).toHaveLength(1);
    expect(Number(unpaid.body.totals.total)).toBe(2200);

    const draft = await request(app).get("/api/v1/platform/invoices/reports?type=draft").set(auth(superToken));
    expect(draft.body.rows).toHaveLength(1);

    const voidR = await request(app).get("/api/v1/platform/invoices/reports?type=void").set(auth(superToken));
    expect(voidR.body.rows).toHaveLength(1);
    expect(Number(voidR.body.totals.total)).toBe(9999);
  });

  it("overdue report includes only past-due issued invoices", async () => {
    await mk({ unitPrice: 100, status: "issued", dueDate: "2020-01-01" }); // overdue
    await mk({ unitPrice: 200, status: "issued", dueDate: "2999-01-01" }); // not overdue
    await mk({ unitPrice: 300, status: "paid", dueDate: "2020-01-01" }); // paid, not overdue
    const overdue = await request(app).get("/api/v1/platform/invoices/reports?type=overdue").set(auth(superToken));
    expect(overdue.body.rows).toHaveLength(1);
    expect(Number(overdue.body.totals.total)).toBe(100);
  });

  it("tax summary groups by flat tax % and excludes void/draft", async () => {
    await mk({ unitPrice: 1000, taxPercent: 18, status: "issued" }); // tax 180
    await mk({ unitPrice: 1000, taxPercent: 18, status: "paid" }); // tax 180
    await mk({ unitPrice: 1000, taxPercent: 5, status: "issued" }); // tax 50
    await mk({ unitPrice: 1000, taxPercent: 18, status: "void" }); // excluded
    await mk({ unitPrice: 1000, taxPercent: 18, status: "draft" }); // excluded
    const tax = await request(app).get("/api/v1/platform/invoices/reports?type=tax").set(auth(superToken));
    expect(tax.status).toBe(200);
    // two tax brackets: 18 and 5
    expect(tax.body.rows).toHaveLength(2);
    const r18 = tax.body.rows.find((r: { taxPercent: string }) => Number(r.taxPercent) === 18);
    expect(Number(r18.taxAmount)).toBe(360); // 180 + 180 (void/draft excluded)
    expect(Number(r18.taxableValue)).toBe(2000);
  });

  it("by-institution + institution filter", async () => {
    await mk({ inst: instA, unitPrice: 1000, status: "issued" });
    await mk({ inst: instA, unitPrice: 500, status: "issued" });
    await mk({ inst: instB, unitPrice: 2000, status: "issued" });

    const byInst = await request(app).get("/api/v1/platform/invoices/reports?type=by-institution").set(auth(superToken));
    expect(byInst.body.rows).toHaveLength(2);
    expect(Number(byInst.body.totals.total)).toBe(3500);

    // institution filter on a list report
    const onlyB = await request(app)
      .get(`/api/v1/platform/invoices/reports?type=all&institutionId=${instB}`)
      .set(auth(superToken));
    expect(onlyB.body.rows).toHaveLength(1);
    expect(Number(onlyB.body.totals.total)).toBe(2000);
  });

  it("advanced search filters are backend-supported", async () => {
    await mk({ unitPrice: 1000, status: "issued", sacCode: "998314", gstin: "29ABCDE1234F1Z5", placeOfSupply: "Karnataka", recipientState: "Karnataka", reverseCharge: true });
    await mk({ unitPrice: 9000, status: "issued", sacCode: "111111", placeOfSupply: "Tamil Nadu", recipientState: "Tamil Nadu", reverseCharge: false });

    const bySac = await request(app).get("/api/v1/platform/invoices?sacCode=998314").set(auth(superToken));
    expect(bySac.body.total).toBe(1);
    const byGstin = await request(app).get("/api/v1/platform/invoices?gstin=29ABCDE").set(auth(superToken));
    expect(byGstin.body.total).toBe(1);
    const byPlace = await request(app).get("/api/v1/platform/invoices?placeOfSupply=Tamil").set(auth(superToken));
    expect(byPlace.body.total).toBe(1);
    const byRc = await request(app).get("/api/v1/platform/invoices?reverseCharge=true").set(auth(superToken));
    expect(byRc.body.total).toBe(1);
    const byAmount = await request(app).get("/api/v1/platform/invoices?amountMin=5000").set(auth(superToken));
    expect(byAmount.body.total).toBe(1);
    expect(Number(byAmount.body.rows[0].total)).toBe(9000);
  });

  it("exports the filtered list as CSV and a valid XLSX", async () => {
    await mk({ unitPrice: 1234, status: "issued", sacCode: "998314" });

    const csv = await request(app)
      .get("/api/v1/platform/invoices/export?format=csv")
      .set(auth(superToken))
      .buffer(true)
      .parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const csvText = csv.body.toString("utf8");
    expect(csvText).toContain("Invoice number");
    expect(csvText).toContain("998314");

    const xlsx = await request(app)
      .get("/api/v1/platform/invoices/export?format=xlsx")
      .set(auth(superToken))
      .buffer(true)
      .parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK"); // valid ZIP/XLSX magic
    expect(xlsx.body.length).toBeGreaterThan(300);
  });

  it("exports a report (CSV) with a totals row", async () => {
    await mk({ unitPrice: 1000, taxPercent: 10, status: "issued" });
    const csv = await request(app)
      .get("/api/v1/platform/invoices/reports?type=all&format=csv")
      .set(auth(superToken))
      .buffer(true)
      .parse(binary);
    expect(csv.status).toBe(200);
    const text = csv.body.toString("utf8");
    expect(text).toContain("Grand total");
    expect(text).toContain("TOTAL");
  });

  it("blocks non-super-admins from reports and exports", async () => {
    const r = await request(app).get("/api/v1/platform/invoices/reports?type=all").set(auth(adminToken));
    expect(r.status).toBe(403);
    const e = await request(app).get("/api/v1/platform/invoices/export?format=csv").set(auth(adminToken));
    expect(e.status).toBe(403);
  });
});
