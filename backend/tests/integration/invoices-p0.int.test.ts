import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const SUPER = { email: "super@test.dev", password: "Passw0rd!" };
const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("billing B2.2 P0: settings, audit, email log, GST fields, void reason", () => {
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

  it("exposes settings and applies them to numbering + new-draft defaults", async () => {
    // Defaults exist (self-healed singleton).
    const initial = await request(app)
      .get("/api/v1/platform/invoice-settings")
      .set(auth(superToken));
    expect(initial.status).toBe(200);
    expect(initial.body.prefix).toBe("SINV-");

    // Update settings (numbering + billing defaults).
    const upd = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(superToken))
      .send({
        prefix: "ACME-",
        numberPadding: 4,
        defaultCurrency: "USD",
        defaultTaxPercent: 9,
        defaultSac: "998314",
        defaultDueDays: 30,
        supplierLegalName: "Acme Software Pvt Ltd",
        supplierGstin: "29ABCDE1234F1Z5",
      });
    expect(upd.status).toBe(200);
    expect(upd.body.prefix).toBe("ACME-");
    expect(upd.body.supplierLegalName).toBe("Acme Software Pvt Ltd");

    // A new draft inherits the defaults.
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "Plan", unitPrice: 100 }] });
    expect(d.body.currency).toBe("USD");
    expect(Number(d.body.taxPercent)).toBe(9);
    expect(d.body.sacCode).toBe("998314");
    expect(d.body.paymentTermsDays).toBe(30);

    // Issue uses the configured prefix + padding (4 digits).
    const i = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));
    expect(i.body.number).toMatch(/^ACME-FY\d{4}-\d{2}-\d{4}$/);

    // Non-super-admin cannot read or change settings.
    const denied = await request(app)
      .patch("/api/v1/platform/invoice-settings")
      .set(auth(adminToken))
      .send({ prefix: "X-" });
    expect(denied.status).toBe(403);
  });

  it("requires a reason to void and records who/when/why", async () => {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 1 }] });

    const noReason = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/void`)
      .set(auth(superToken))
      .send({});
    expect(noReason.status).toBe(400);

    const voided = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/void`)
      .set(auth(superToken))
      .send({ reason: "Created by mistake" });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe("void");
    expect(voided.body.voidReason).toBe("Created by mistake");
    expect(voided.body.voidedAt).toBeTruthy();
  });

  it("stores and edits GST-readiness fields", async () => {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({
        sacCode: "998314",
        placeOfSupply: "Karnataka",
        reverseCharge: true,
        recipientState: "Karnataka",
        recipientStateCode: "29",
        lines: [{ description: "x", unitPrice: 1, sacCode: "998314" }],
      });
    expect(d.body.sacCode).toBe("998314");
    expect(d.body.placeOfSupply).toBe("Karnataka");
    expect(d.body.reverseCharge).toBe(true);
    expect(d.body.recipientStateCode).toBe("29");
    expect(d.body.lines[0].sacCode).toBe("998314");

    const edited = await request(app)
      .patch(`/api/v1/platform/invoices/${d.body.id}`)
      .set(auth(superToken))
      .send({ reverseCharge: false, placeOfSupply: "Tamil Nadu" });
    expect(edited.body.reverseCharge).toBe(false);
    expect(edited.body.placeOfSupply).toBe("Tamil Nadu");
  });

  it("records a money-action audit timeline", async () => {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 100 }] });
    await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));
    await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/mark-paid`)
      .set(auth(superToken))
      .send({ paymentMethod: "cash" });

    const audit = await request(app)
      .get(`/api/v1/platform/invoices/${d.body.id}/audit`)
      .set(auth(superToken));
    expect(audit.status).toBe(200);
    const actions = audit.body.map((a: { action: string }) => a.action);
    expect(actions).toContain("invoice.created");
    expect(actions).toContain("invoice.issued");
    expect(actions).toContain("invoice.paid");
    // Newest first, attributed to the acting super-admin.
    expect(audit.body[0].actorEmail).toBe(SUPER.email);

    // Audit endpoint is super-admin only.
    const denied = await request(app)
      .get(`/api/v1/platform/invoices/${d.body.id}/audit`)
      .set(auth(adminToken));
    expect(denied.status).toBe(403);
  });

  it("logs email delivery attempts on issue and resend", async () => {
    // An active admin in the invoice's institution is the recipient.
    await createUser({
      email: "tenantadmin@test.dev",
      password: "Passw0rd!",
      role: "admin",
      institutionId: instId,
    });
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ lines: [{ description: "x", unitPrice: 1 }] });
    await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));

    const afterIssue = await request(app)
      .get(`/api/v1/platform/invoices/${d.body.id}`)
      .set(auth(superToken));
    expect(afterIssue.body.emails.length).toBe(1);
    expect(afterIssue.body.emails[0].recipient).toBe("tenantadmin@test.dev");
    expect(["sent", "failed", "skipped"]).toContain(afterIssue.body.emails[0].status);

    // Resend logs another attempt.
    const resent = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/resend`)
      .set(auth(superToken));
    expect(resent.status).toBe(200);
    const afterResend = await request(app)
      .get(`/api/v1/platform/invoices/${d.body.id}`)
      .set(auth(superToken));
    expect(afterResend.body.emails.length).toBe(2);
  });

  it("includes the round_off field and serves a richer PDF", async () => {
    const d = await request(app)
      .post(`/api/v1/platform/institutions/${instId}/invoices`)
      .set(auth(superToken))
      .send({ taxPercent: 18, lines: [{ description: "Plan", unitPrice: 1000 }] });
    expect(d.body.roundOff).toBeDefined();
    const issued = await request(app)
      .post(`/api/v1/platform/invoices/${d.body.id}/issue`)
      .set(auth(superToken));
    const pdf = await request(app)
      .get(`/api/v1/platform/invoices/${issued.body.id}/pdf`)
      .set(auth(superToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
  });
});
