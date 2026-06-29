import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

// Collect a binary (CSV/XLSX) response body into a Buffer for supertest.
const binary = (res: import("http").IncomingMessage, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("super admin — tenant / institution management", () => {
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) => request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) => request(app).patch(p).set(auth(t)).send(body as object);

  async function createTenant(body: Record<string, unknown>) {
    return post("/api/v1/platform/tenants", tok.root, body);
  }

  beforeEach(async () => {
    await resetDb();
    await createUser({ email: "root@platform.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@platform.dev", PW);
    await createUser({ email: "tenantadmin@x.dev", password: PW, role: "admin" });
    tok.admin = await tokenFor("tenantadmin@x.dev", PW);
  });

  it("creates a school tenant in draft with derived structural type", async () => {
    const res = await createTenant({ name: "Green School", code: "GRN", institutionType: "school", email: "a@grn.edu", phone: "123", address: "X" });
    expect(res.status).toBe(201);
    expect(res.body.institutionType).toBe("school");
    expect(res.body.type).toBe("school"); // structural
    expect(res.body.status).toBe("draft");
    expect(res.body.isActive).toBe(false);
    expect(res.body.slug).toBe("grn");
  });

  it("derives college structural type for university/coaching/other", async () => {
    for (const [it, code] of [["university", "UNI"], ["coaching", "CO"], ["other", "OTH"]] as const) {
      const res = await createTenant({ name: `T ${code}`, code, institutionType: it });
      expect(res.status).toBe(201);
      expect(res.body.institutionType).toBe(it);
      expect(res.body.type).toBe("college");
    }
  });

  it("rejects a duplicate code (409) and blocks non-super-admins (403)", async () => {
    await createTenant({ name: "Dup", code: "DUP", institutionType: "school" });
    expect((await createTenant({ name: "Dup2", code: "DUP", institutionType: "school" })).status).toBe(409);
    expect((await post("/api/v1/platform/tenants", tok.admin, { name: "X", code: "ZZ", institutionType: "school" })).status).toBe(403);
    expect((await get("/api/v1/platform/tenants", tok.admin)).status).toBe(403);
  });

  it("updates profile and re-derives type when institution_type changes", async () => {
    const t = await createTenant({ name: "Flex", code: "FLEX", institutionType: "school" });
    const id = t.body.id;
    const upd = await patch(`/api/v1/platform/tenants/${id}`, tok.root, { city: "Pune", institutionType: "university" });
    expect(upd.status).toBe(200);
    expect(upd.body.city).toBe("Pune");
    expect(upd.body.institutionType).toBe("university");
    expect(upd.body.type).toBe("college");
  });

  it("runs the lifecycle and keeps is_active in sync (suspend/archive need a reason)", async () => {
    const t = await createTenant({ name: "Life", code: "LIFE", institutionType: "school" });
    const id = t.body.id;
    const activate = await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "active" });
    expect(activate.body.status).toBe("active");
    expect(activate.body.isActive).toBe(true);
    // suspend without a reason → 400
    expect((await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "suspended" })).status).toBe(400);
    const sus = await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "suspended", reason: "Non-payment" });
    expect(sus.body.status).toBe("suspended");
    expect(sus.body.isActive).toBe(false);
    const arch = await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "archived", reason: "Closed account" });
    expect(arch.body.status).toBe("archived");
    expect(arch.body.isActive).toBe(false);
    // archived tenants are filtered out of an active-status query
    const active = await get("/api/v1/platform/tenants?status=active", tok.root);
    expect(active.body.rows.some((r: { id: string }) => r.id === id)).toBe(false);
  });

  it("updates type-based settings (academic structure / modules / school settings)", async () => {
    const t = await createTenant({ name: "Set", code: "SET", institutionType: "school" });
    const id = t.body.id;
    const upd = await patch(`/api/v1/platform/tenants/${id}/settings`, tok.root, {
      academicStructure: { levels: ["class", "section"] },
      enabledModules: { fees: true, library: false },
      schoolSettings: { houseSystem: true, examPattern: "term", attendanceMode: "daily" },
      communication: { emailSenderName: "GoCampus", notifyEmail: true, notifySms: false, whatsappEnabled: true },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.settings.enabledModules.fees).toBe(true);
    expect(upd.body.settings.schoolSettings.houseSystem).toBe(true);
    expect(upd.body.settings.academicStructure.levels).toEqual(["class", "section"]);
    expect(upd.body.settings.communication.emailSenderName).toBe("GoCampus");
    expect(upd.body.settings.communication.notifyEmail).toBe(true);
    expect(upd.body.settings.communication.whatsappEnabled).toBe(true);
  });

  it("tracks onboarding progress and completes it (activates a draft)", async () => {
    const t = await createTenant({ name: "OB", code: "OB", institutionType: "school", email: "o@b.edu", phone: "9", address: "A" });
    const id = t.body.id;
    expect(t.body.onboardingProgress.completion).toBeGreaterThanOrEqual(0);
    expect(t.body.onboardingProgress.steps.find((s: { key: string }) => s.key === "profile").done).toBe(true);
    const mark = await post(`/api/v1/platform/tenants/${id}/onboarding/step`, tok.root, { step: "branding", done: true });
    expect(mark.body.onboardingProgress.steps.find((s: { key: string }) => s.key === "branding").done).toBe(true);
    // satisfy remaining required steps (academic structure + primary admin); profile + slug already done
    await patch(`/api/v1/platform/tenants/${id}/settings`, tok.root, { academicStructure: { levels: ["class"] } });
    await post(`/api/v1/platform/tenants/${id}/admin`, tok.root, { fullName: "OB Admin", email: "obadmin@b.edu" });
    const done = await post(`/api/v1/platform/tenants/${id}/onboarding/complete`, tok.root);
    expect(done.body.status).toBe("active");
    expect(done.body.onboardingProgress.completedAt).toBeTruthy();
  });

  it("blocks activation until required onboarding steps are done, unless overridden", async () => {
    const t = await createTenant({ name: "Enforce", code: "ENF", institutionType: "school" });
    const id = t.body.id; // minimal: missing profile + academic structure + primary admin
    const blocked = await post(`/api/v1/platform/tenants/${id}/onboarding/complete`, tok.root);
    expect(blocked.status).toBe(400);
    const overridden = await post(`/api/v1/platform/tenants/${id}/onboarding/complete`, tok.root, { override: true });
    expect(overridden.status).toBe(200);
    expect(overridden.body.status).toBe("active");
  });

  it("creates a primary admin (secure, no password leak) and toggles it", async () => {
    const t = await createTenant({ name: "Adm", code: "ADM", institutionType: "school" });
    const id = t.body.id;
    const res = await post(`/api/v1/platform/tenants/${id}/admin`, tok.root, { fullName: "Alice", email: "alice@adm.edu" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const admin = res.body.admins.find((a: { email: string }) => a.email === "alice@adm.edu");
    expect(admin).toBeTruthy();
    // duplicate email → 409
    expect((await post(`/api/v1/platform/tenants/${id}/admin`, tok.root, { fullName: "Dup", email: "alice@adm.edu" })).status).toBe(409);
    // disable
    const off = await patch(`/api/v1/platform/tenants/${id}/admin/${admin.id}`, tok.root, { active: false });
    expect(off.body.admins.find((a: { id: string }) => a.id === admin.id).isActive).toBe(false);
  });

  it("manages internal CRM notes (super-admin only)", async () => {
    const t = await createTenant({ name: "Note", code: "NOTE", institutionType: "school" });
    const id = t.body.id;
    const added = await post(`/api/v1/platform/tenants/${id}/notes`, tok.root, { noteType: "billing", body: "Called about renewal" });
    expect(added.status).toBe(200);
    expect(added.body).toHaveLength(1);
    const noteId = added.body[0].id;
    const upd = await patch(`/api/v1/platform/tenants/notes/${noteId}`, tok.root, { body: "Renewal confirmed" });
    expect(upd.body[0].body).toBe("Renewal confirmed");
    const del = await request(app).delete(`/api/v1/platform/tenants/notes/${noteId}`).set(auth(tok.root));
    expect(del.status).toBe(200);
    expect(del.body).toHaveLength(0);
    // tenant admins cannot read internal notes
    expect((await get(`/api/v1/platform/tenants/${id}/notes`, tok.admin)).status).toBe(403);
  });

  it("updates compliance/approval and stamps the approver", async () => {
    const t = await createTenant({ name: "Comp", code: "COMP", institutionType: "school" });
    const id = t.body.id;
    const upd = await patch(`/api/v1/platform/tenants/${id}/compliance`, tok.root, {
      termsAccepted: true, dataProcessingConsent: true, kycStatus: "verified", approvalStatus: "approved", approvalRemarks: "All docs ok",
    });
    expect(upd.status).toBe(200);
    expect(upd.body.termsAccepted).toBe(true);
    expect(upd.body.dataProcessingConsent).toBe(true);
    expect(upd.body.kycStatus).toBe("verified");
    expect(upd.body.approvalStatus).toBe("approved");
    expect(upd.body.approvedAt).toBeTruthy();
  });

  it("surfaces a read-only billing summary for the tenant", async () => {
    const t = await createTenant({ name: "Bill", code: "BILL", institutionType: "school" });
    const id = t.body.id;
    // Create + issue an invoice via the (unchanged) invoice module.
    const draft = await post(`/api/v1/platform/institutions/${id}/invoices`, tok.root, { lines: [{ description: "Plan", unitPrice: 1000 }] });
    await post(`/api/v1/platform/invoices/${draft.body.id}/issue`, tok.root);
    const detail = await get(`/api/v1/platform/tenants/${id}`, tok.root);
    expect(detail.body.billing.total).toBe(1);
    expect(detail.body.billing.issued).toBe(1);
    expect(Number(detail.body.billing.outstanding)).toBe(1000);
    expect(detail.body.billing.latest.number).toMatch(/^SINV-/);
    // dedicated billing endpoint too
    expect((await get(`/api/v1/platform/tenants/${id}/billing`, tok.root)).body.issued).toBe(1);
  });

  it("lists/filters/paginates and exports the tenant directory", async () => {
    await createTenant({ name: "Alpha", code: "AL", institutionType: "school" });
    await createTenant({ name: "Beta", code: "BE", institutionType: "university" });
    await createTenant({ name: "Gamma", code: "GA", institutionType: "coaching" });
    const all = await get("/api/v1/platform/tenants?pageSize=2", tok.root);
    expect(all.body.total).toBe(3);
    expect(all.body.rows).toHaveLength(2);
    const unis = await get("/api/v1/platform/tenants?institutionType=university", tok.root);
    expect(unis.body.rows.every((r: { institutionType: string }) => r.institutionType === "university")).toBe(true);
    const search = await get("/api/v1/platform/tenants?q=Beta", tok.root);
    expect(search.body.rows[0].code).toBe("BE");

    const csv = await request(app).get("/api/v1/platform/tenants/export?format=csv").set(auth(tok.root)).buffer(true).parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.body.toString("utf8")).toContain("Alpha");
    const xlsx = await request(app).get("/api/v1/platform/tenants/export?format=xlsx").set(auth(tok.root)).buffer(true).parse(binary);
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("returns rich detail (usage, limits, onboarding) and audits tenant actions", async () => {
    const t = await createTenant({ name: "Rich", code: "RICH", institutionType: "school" });
    const id = t.body.id;
    const d = await get(`/api/v1/platform/tenants/${id}`, tok.root);
    expect(d.body).toHaveProperty("usage");
    expect(d.body.usage).toHaveProperty("students");
    expect(d.body).toHaveProperty("limits");
    expect(d.body).toHaveProperty("onboardingProgress");
    expect(d.body.recentActivity.some((a: { action: string }) => a.action === "tenant.create")).toBe(true);
    // never hard-deletes: there is no DELETE /tenants/:id route
    const delAttempt = await request(app).delete(`/api/v1/platform/tenants/${id}`).set(auth(tok.root));
    expect([404, 405]).toContain(delAttempt.status);
  });

  it("supports the closed lifecycle status (reason required, deactivates)", async () => {
    const t = await createTenant({ name: "Close", code: "CLOSE", institutionType: "school" });
    const id = t.body.id;
    expect((await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "closed" })).status).toBe(400);
    const closed = await post(`/api/v1/platform/tenants/${id}/lifecycle`, tok.root, { status: "closed", reason: "Contract ended" });
    expect(closed.body.status).toBe("closed");
    expect(closed.body.isActive).toBe(false);
  });

  it("updates CRM fields (account manager, last contacted)", async () => {
    const t = await createTenant({ name: "Crm", code: "CRM", institutionType: "school" });
    const upd = await patch(`/api/v1/platform/tenants/${t.body.id}/crm`, tok.root, { accountManager: "Riya", lastContactedAt: new Date().toISOString() });
    expect(upd.status).toBe(200);
    expect(upd.body.accountManager).toBe("Riya");
    expect(upd.body.lastContactedAt).toBeTruthy();
  });

  it("updates per-tenant branding", async () => {
    const t = await createTenant({ name: "Brand", code: "BRND", institutionType: "school" });
    const upd = await patch(`/api/v1/platform/tenants/${t.body.id}/branding`, tok.root, { displayName: "Brand Public", primaryColor: "#112233", tagline: "Learn more", letterhead: "Brand Public School, Pune", footer: "Reg. 12345 · brand.edu" });
    expect(upd.status).toBe(200);
    expect(upd.body.branding.displayName).toBe("Brand Public");
    expect(upd.body.branding.primaryColor).toBe("#112233");
    expect(upd.body.branding.letterhead).toBe("Brand Public School, Pune");
    expect(upd.body.branding.footer).toBe("Reg. 12345 · brand.edu");
  });

  it("returns a real-data health snapshot", async () => {
    const t = await createTenant({ name: "Hlth", code: "HLTH", institutionType: "school" });
    const h = await get(`/api/v1/platform/tenants/${t.body.id}/health`, tok.root);
    expect(h.status).toBe(200);
    expect(h.body.usage).toHaveProperty("students");
    expect(typeof h.body.storageBytes).toBe("number");
    expect(h.body.billing).toHaveProperty("outstanding");
  });

  it("emails a setup/reset link to a tenant admin and reports email status", async () => {
    const t = await createTenant({ name: "Reset", code: "RST", institutionType: "school" });
    const id = t.body.id;
    const add = await post(`/api/v1/platform/tenants/${id}/admin`, tok.root, { fullName: "Bob", email: "bob@rst.edu" });
    const adminId = add.body.admins.find((a: { email: string }) => a.email === "bob@rst.edu").id;
    const link = await post(`/api/v1/platform/tenants/${id}/admin/${adminId}/reset-link`, tok.root);
    expect(link.status).toBe(200);
    expect(typeof link.body.emailSent).toBe("boolean"); // false when SMTP is unconfigured (test env)
  });

  it("manages tenant documents (upload, verify, download, archive, delete) — super-admin only", async () => {
    const t = await createTenant({ name: "Docs", code: "DOCS", institutionType: "school" });
    const id = t.body.id;
    const pdf = Buffer.from("%PDF-1.4 test document bytes");
    const up = await request(app).post(`/api/v1/platform/tenants/${id}/documents`).set(auth(tok.root))
      .field("category", "registration").attach("file", pdf, { filename: "reg.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(200);
    expect(up.body).toHaveLength(1);
    const docId = up.body[0].id;
    expect(up.body[0].verificationStatus).toBe("pending");
    // tenant admin may NOT upload (super-admin surface)
    const forbidden = await request(app).post(`/api/v1/platform/tenants/${id}/documents`).set(auth(tok.admin))
      .field("category", "other").attach("file", pdf, { filename: "x.pdf", contentType: "application/pdf" });
    expect(forbidden.status).toBe(403);
    // verify
    const ver = await patch(`/api/v1/platform/tenants/${id}/documents/${docId}/verify`, tok.root, { status: "verified", remarks: "ok" });
    expect(ver.body[0].verificationStatus).toBe("verified");
    // download bytes
    const dl = await request(app).get(`/api/v1/platform/tenants/${id}/documents/${docId}/download`).set(auth(tok.root)).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    expect(dl.body.toString("utf8")).toContain("%PDF");
    // soft archive then hard delete (a document, never the tenant)
    expect((await post(`/api/v1/platform/tenants/${id}/documents/${docId}/archive`, tok.root)).body[0].archivedAt).toBeTruthy();
    const del = await request(app).delete(`/api/v1/platform/tenants/${id}/documents/${docId}`).set(auth(tok.root));
    expect(del.status).toBe(200);
    expect(del.body).toHaveLength(0);
  });

  it("rejects an unsupported document type", async () => {
    const t = await createTenant({ name: "BadDoc", code: "BADDOC", institutionType: "school" });
    const bad = await request(app).post(`/api/v1/platform/tenants/${t.body.id}/documents`).set(auth(tok.root))
      .field("category", "other").attach("file", Buffer.from("MZ exe"), { filename: "evil.exe", contentType: "application/octet-stream" });
    expect(bad.status).toBe(400);
  });

  it("exports a tenant's profile and users (CSV)", async () => {
    const t = await createTenant({ name: "Export Co", code: "EXP", institutionType: "school" });
    const id = t.body.id;
    await post(`/api/v1/platform/tenants/${id}/admin`, tok.root, { fullName: "U One", email: "u@exp.edu" });
    const prof = await request(app).get(`/api/v1/platform/tenants/${id}/export?format=csv`).set(auth(tok.root)).buffer(true).parse(binary);
    expect(prof.status).toBe(200);
    expect(prof.body.toString("utf8")).toContain("Export Co");
    const users = await request(app).get(`/api/v1/platform/tenants/${id}/users/export?format=csv`).set(auth(tok.root)).buffer(true).parse(binary);
    expect(users.body.toString("utf8")).toContain("u@exp.edu");
  });

  it("exposes normalized enabledModules via /auth/me for sidebar gating", async () => {
    const t = await createTenant({ name: "Mods", code: "MODS", institutionType: "school" });
    const id = t.body.id;
    await patch(`/api/v1/platform/tenants/${id}/settings`, tok.root, {
      enabledModules: { fees: true, library: false, students: true },
    });
    await createUser({ email: "modadmin@x.dev", password: PW, role: "admin", institutionId: id });
    const token = await tokenFor("modadmin@x.dev", PW);
    const me = await get("/api/v1/auth/me", token);
    expect(me.status).toBe(200);
    expect(Array.isArray(me.body.enabledModules)).toBe(true);
    expect(me.body.enabledModules).toEqual(expect.arrayContaining(["fees", "students"]));
    expect(me.body.enabledModules).not.toContain("library");
  });

  it("filters the directory by package and created-date range", async () => {
    const a = await createTenant({ name: "PkgCo", code: "PKGCO", institutionType: "school" });
    await createTenant({ name: "NoPkg", code: "NOPKG", institutionType: "school" });
    const pkg = await query<{ id: string }>(
      `INSERT INTO subscription_packages (name, max_students, max_staff, price, billing_cycle)
       VALUES ('GoldPlan', 100, 10, 1000, 'monthly') RETURNING id`
    );
    await query(
      `INSERT INTO institution_subscriptions (institution_id, package_id, status, starts_at) VALUES ($1, $2, 'active', now())`,
      [a.body.id, pkg.rows[0].id]
    );
    const byPkg = await get("/api/v1/platform/tenants?package=Gold", tok.root);
    expect(byPkg.body.rows).toHaveLength(1);
    expect(byPkg.body.rows[0].code).toBe("PKGCO");
    const future = await get("/api/v1/platform/tenants?createdFrom=2999-01-01", tok.root);
    expect(future.body.total).toBe(0);
    const past = await get("/api/v1/platform/tenants?createdFrom=2000-01-01", tok.root);
    expect(past.body.total).toBeGreaterThanOrEqual(2);
  });
});
