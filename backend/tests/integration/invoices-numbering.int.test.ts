import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const trailing = (num: string) => Number((num.match(/(\d+)$/) || [])[1]);

describe("billing: settable continuous invoice numbering", () => {
  let superToken: string;
  let adminToken: string;
  let instId: string;

  async function issue(): Promise<string> {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 1 }] });
    const i = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));
    return i.body.number as string;
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...SUPER, role: "super_admin" });
    await createUser({ ...ADMIN, role: "admin" });
    superToken = await tokenFor(SUPER.email, SUPER.password);
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
    instId = await createInstitution("INV");
  });

  it("assigns a continuous, gap-free running number (keeps the FY segment)", async () => {
    const n1 = await issue();
    const n2 = await issue();
    const n3 = await issue();
    expect(n1).toMatch(/^SINV-FY\d{4}-\d{2}-\d{6}$/);
    expect(trailing(n2)).toBe(trailing(n1) + 1);
    expect(trailing(n3)).toBe(trailing(n2) + 1);
  });

  it("lets the operator set the next number; issuance continues from it", async () => {
    const seed = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextInvoiceNumber: 5000 });
    expect(seed.status).toBe(200);
    expect(seed.body.nextInvoiceNumber).toBe(5000);

    const n1 = await issue();
    const n2 = await issue();
    expect(trailing(n1)).toBe(5000);
    expect(n1.endsWith("005000")).toBe(true); // padded to 6
    expect(trailing(n2)).toBe(5001);

    // Settings now reports the next as 5002.
    const got = await request(app).get("/api/v1/platform/invoice-settings").set(auth(superToken));
    expect(got.body.nextInvoiceNumber).toBe(5002);
  });

  it("rejects setting the next number below the highest already-issued", async () => {
    await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextInvoiceNumber: 9000 });
    await issue(); // issues 9000, next becomes 9001

    const tooLow = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextInvoiceNumber: 5 });
    expect(tooLow.status).toBe(400);

    // At/above the highest issued is allowed.
    const ok = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({ nextInvoiceNumber: 9001 });
    expect(ok.status).toBe(200);
  });

  it("blocks non-super-admins from changing numbering", async () => {
    const denied = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(adminToken))
      .send({ nextInvoiceNumber: 100 });
    expect(denied.status).toBe(403);
  });
});
