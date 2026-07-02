import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  query,
  resetDb,
  tokenFor,
} from "./helpers";

// B3 — plan-limit enforcement completeness: storage quota, scheduled-report
// quota, per-tenant feature flags, per-tenant rate limiting, and usage surfacing.

const PW = "Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\nfake b3 doc\n%%EOF");

describe("B3 — plan-limit enforcement", () => {
  let inst: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const uploadAs = (
    t: string,
    fields: Record<string, string>,
    file: { buffer: Buffer; filename: string; contentType: string }
  ) => {
    let r = request(app).post("/api/v1/documents").set(auth(t));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach("file", file.buffer, { filename: file.filename, contentType: file.contentType });
  };

  /** Simulate prior storage usage by inserting a document row of a given size. */
  async function seedDoc(bytes: number): Promise<void> {
    await query(
      `INSERT INTO documents
         (institution_id, owner_type, category, original_name, safe_name,
          mime_type, size_bytes, storage_key, storage_mode)
       VALUES ($1, 'institution', 'document', 'seed.pdf', 'seed.pdf',
               'application/pdf', $2, 'seed-key', 'local')`,
      [inst, bytes]
    );
  }

  beforeEach(async () => {
    await resetDb();
    inst = await createInstitution("B3");
    await createUser({ email: "super@b3.dev", password: PW, role: "super_admin", institutionId: null });
    await createUser({ email: "admin@b3.dev", password: PW, role: "admin", institutionId: inst });
    tok.super = await tokenFor("super@b3.dev", PW);
    tok.admin = await tokenFor("admin@b3.dev", PW);
  });

  // ---- Storage quota ----

  it("blocks an upload that would exceed the storage quota, and surfaces usage", async () => {
    const lim = await patch(`/api/v1/platform/institutions/${inst}/limits`, tok.super, {
      storageLimitMb: 1,
    });
    expect(lim.status).toBe(200);
    await seedDoc(1024 * 1024 * 2); // 2 MB already used → over the 1 MB cap

    const blocked = await uploadAs(
      tok.admin,
      { ownerType: "institution", category: "document" },
      { buffer: PDF, filename: "over.pdf", contentType: "application/pdf" }
    );
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/storage/i);

    const limits = await get(`/api/v1/admin/institutions/${inst}/limits`, tok.super);
    expect(limits.body.storageLimitMb).toBe(1);
    expect(limits.body.storageUsedMb).toBeGreaterThanOrEqual(2);
    expect(limits.body.withinLimits).toBe(false);
  });

  it("allows an upload comfortably within the storage quota", async () => {
    await patch(`/api/v1/platform/institutions/${inst}/limits`, tok.super, { storageLimitMb: 50 });
    const ok = await uploadAs(
      tok.admin,
      { ownerType: "institution", category: "document" },
      { buffer: PDF, filename: "ok.pdf", contentType: "application/pdf" }
    );
    expect(ok.status).toBe(201);
  });

  it("treats no storage override as unlimited (upload allowed)", async () => {
    const ok = await uploadAs(
      tok.admin,
      { ownerType: "institution", category: "document" },
      { buffer: PDF, filename: "free.pdf", contentType: "application/pdf" }
    );
    expect(ok.status).toBe(201);
  });

  // ---- Scheduled-report quota ----

  it("enforces the scheduled-report quota and surfaces the count", async () => {
    await patch(`/api/v1/platform/institutions/${inst}/limits`, tok.super, {
      scheduledReportsQuota: 1,
    });
    // Seed two existing schedules → the institution is over its quota of 1.
    await query(
      `INSERT INTO scheduled_reports (institution_id, name, frequency)
       VALUES ($1, 'Seeded A', 'daily'), ($1, 'Seeded B', 'weekly')`,
      [inst]
    );

    const limits = await get(`/api/v1/admin/institutions/${inst}/limits`, tok.super);
    expect(limits.body.scheduledReportsQuota).toBe(1);
    expect(limits.body.scheduledReports).toBe(2);
    expect(limits.body.withinLimits).toBe(false);

    // A new schedule is rejected by the quota BEFORE the report is even looked up.
    const blocked = await post("/api/v1/scheduled-reports", tok.admin, {
      reportId: "00000000-0000-0000-0000-000000000000",
      name: "Another",
      frequency: "daily",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/scheduled report/i);
  });

  // ---- Per-tenant feature flags (default-allow) ----

  it("gates an optional module behind a per-tenant feature flag (default-allow)", async () => {
    // Default-allow: with no flag set, the module is reachable.
    expect((await get("/api/v1/live-classes", tok.admin)).status).toBe(200);

    // Super-admin turns it off for this tenant.
    const off = await patch(`/api/v1/admin/institutions/${inst}/settings`, tok.super, {
      featureFlags: { liveClasses: false },
    });
    expect(off.status).toBe(200);
    const blocked = await get("/api/v1/live-classes", tok.admin);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/not enabled/i);

    // Turning it back on restores access.
    await patch(`/api/v1/admin/institutions/${inst}/settings`, tok.super, {
      featureFlags: { liveClasses: true },
    });
    expect((await get("/api/v1/live-classes", tok.admin)).status).toBe(200);
  });

  // ---- Per-tenant rate limiting on the external API ----

  it("rate-limits /ext per institution and isolates other tenants", async () => {
    // TENANT_RATE_LIMIT_MAX is 5 in the integration config.
    const k1 = await post("/api/v1/integrations/api-keys", tok.admin, { name: "b3-key" });
    expect(k1.status).toBe(201);
    const key1 = k1.body.key as string;

    let sawLimit = false;
    let lastOk = false;
    for (let i = 0; i < 7; i++) {
      const r = await request(app).get("/api/v1/ext/me").set("x-api-key", key1);
      if (r.status === 429) sawLimit = true;
      else lastOk = r.status === 200;
    }
    expect(sawLimit).toBe(true); // the tenant tripped its own cap
    expect(lastOk || sawLimit).toBe(true);

    // A different institution's key is unaffected — proves per-tenant keying.
    const inst2 = await createInstitution("B3B");
    await createUser({ email: "admin@b3b.dev", password: PW, role: "admin", institutionId: inst2 });
    const tok2 = await tokenFor("admin@b3b.dev", PW);
    const k2 = await post("/api/v1/integrations/api-keys", tok2, { name: "b3b-key" });
    const other = await request(app).get("/api/v1/ext/me").set("x-api-key", k2.body.key as string);
    expect(other.status).toBe(200);
  });
});
