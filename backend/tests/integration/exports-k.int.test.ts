import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";
// Nothing in any API response, artifact, or manifest may match this.
const SECRET_RE = /password|secret|token|storage_key|storageKey|accessKey/i;

/** Read a (possibly binary) supertest response body as bytes across shapes. */
function bytesOf(res: request.Response): Buffer {
  if (Buffer.isBuffer(res.body) && res.body.length) return res.body;
  return Buffer.from(res.text ?? "", "binary");
}
function textOf(res: request.Response): string {
  if (res.text && res.text.length) return res.text;
  if (Buffer.isBuffer(res.body)) return res.body.toString("utf8");
  return "";
}

/** Super Admin K — Data Export Center. */
describe("Super Admin K — Data Export Center", () => {
  const tok: Record<string, string> = {};
  let instId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string, body?: unknown) =>
    request(app).delete(p).set(auth(t)).send(body as object);

  beforeEach(async () => {
    await resetDb();
    // export_settings is a migration-seeded singleton (not truncated) — reset it.
    await query(
      `INSERT INTO export_settings (id) VALUES (1)
       ON CONFLICT (id) DO UPDATE SET default_retention_days = 7, sensitive_retention_days = 2`
    );
    await createUser({ email: "root@k.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@k.dev", PW);
    await createUser({ email: "root2@k.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root2 = await tokenFor("root2@k.dev", PW);
    instId = await createInstitution("KION", "school");
    // A tenant user whose (bcrypt) password hash lives in the DB — masking must
    // never let it reach any artifact.
    await createUser({ email: "teacher@k.dev", password: PW, role: "teacher", institutionId: instId, fullName: "Teacher K" });
    // A tenant admin (non-super-admin) for the RBAC boundary test.
    await createUser({ email: "admin@k.dev", password: PW, role: "admin", institutionId: instId });
    tok.tenant = await tokenFor("admin@k.dev", PW);
  });

  it("serves the dashboard summary with cards and no secrets", async () => {
    const res = await get("/api/v1/exports/summary", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.totals).toBeDefined();
    expect(res.body.schedules).toBeDefined();
    expect(Array.isArray(res.body.recentEvents)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(SECRET_RE);
  });

  it("creates a non-sensitive export (institutions) → completed with artifact + checksum + manifest", async () => {
    const res = await post("/api/v1/exports", tok.root, {
      name: "All institutions",
      scope: "institutions",
      format: "csv",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed");
    expect(res.body.hasArtifact).toBe(true);
    expect(res.body.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.rowCount).toBeGreaterThanOrEqual(1);
    // The public projection never exposes the storage key.
    expect(res.body).not.toHaveProperty("storageKey");
    expect(res.body).not.toHaveProperty("storage_key");

    const man = await get(`/api/v1/exports/${res.body.id}/manifest`, tok.root);
    expect(man.status).toBe(200);
    expect(man.body.checksum).toBe(res.body.checksum);
    expect(man.body.scope).toBe("institutions");
    expect(Array.isArray(man.body.files)).toBe(true);
    expect(JSON.stringify(man.body)).not.toMatch(SECRET_RE);
  });

  it("requires a reason to download, audits it and increments the count", async () => {
    const created = await post("/api/v1/exports", tok.root, { name: "inst", scope: "institutions", format: "csv" });
    const id = created.body.id;
    expect((await get(`/api/v1/exports/${id}/download`, tok.root)).status).toBe(400);

    const dl = await get(`/api/v1/exports/${id}/download?reason=quarterly-review`, tok.root).buffer(true);
    expect(dl.status).toBe(200);
    expect(textOf(dl)).not.toMatch(SECRET_RE);

    const after = await get(`/api/v1/exports/${id}`, tok.root);
    expect(after.body.downloadCount).toBe(1);

    const audit = await get("/api/v1/platform/audit?action=export.downloaded", tok.root);
    expect(audit.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("lists, filters and paginates exports (no secrets)", async () => {
    await post("/api/v1/exports", tok.root, { name: "list institutions", scope: "institutions", format: "csv" });
    await post("/api/v1/exports", tok.root, { name: "list packages", scope: "packages", format: "csv" });

    const all = await get("/api/v1/exports?pageSize=1&page=1", tok.root);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.rows).toHaveLength(1);

    const filtered = await get("/api/v1/exports?scope=packages", tok.root);
    expect(filtered.body.rows.every((r: { scope: string }) => r.scope === "packages")).toBe(true);
    expect(JSON.stringify(all.body)).not.toMatch(SECRET_RE);
  });

  it("requires a reason for a sensitive scope (audit_logs)", async () => {
    const noReason = await post("/api/v1/exports", tok.root, { name: "audit", scope: "audit_logs", format: "csv" });
    expect(noReason.status).toBe(400);
  });

  it("routes a high-risk scope (security_reports) through approval before generating", async () => {
    const created = await post("/api/v1/exports", tok.root, {
      name: "sec",
      scope: "security_reports",
      format: "csv",
      reason: "incident review",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.approvalStatus).toBe("pending");
    expect(created.body.hasArtifact).toBe(false);
    const id = created.body.id;

    // Not downloadable until approved.
    expect((await get(`/api/v1/exports/${id}/download?reason=too-early`, tok.root)).status).toBe(400);

    // Self-approval is blocked (same super-admin who requested it).
    const self = await post(`/api/v1/exports/${id}/decide`, tok.root, { decision: "approved", reason: "approving my own" });
    expect(self.status).toBe(403);

    // A second super-admin approves → the artifact is generated.
    const approve = await post(`/api/v1/exports/${id}/decide`, tok.root2, { decision: "approved", reason: "reviewed and cleared" });
    expect(approve.status).toBe(200);
    expect(approve.body.approvalStatus).toBe("approved");
    expect(approve.body.status).toBe("completed");
    expect(approve.body.hasArtifact).toBe(true);

    const dl = await get(`/api/v1/exports/${id}/download?reason=post-approval`, tok.root).buffer(true);
    expect(dl.status).toBe(200);
  });

  it("rejects a high-risk export request and refuses to generate it", async () => {
    const created = await post("/api/v1/exports", tok.root, {
      name: "audit-pull",
      scope: "audit_logs",
      format: "csv",
      reason: "compliance pull",
    });
    expect(created.body.approvalStatus).toBe("pending");
    const id = created.body.id;

    const rej = await post(`/api/v1/exports/${id}/decide`, tok.root2, { decision: "rejected", reason: "not right now" });
    expect(rej.status).toBe(200);
    expect(rej.body.approvalStatus).toBe("rejected");
    expect(rej.body.hasArtifact).toBe(false);
    expect((await get(`/api/v1/exports/${id}/download?reason=try-anyway`, tok.root)).status).toBe(400);
  });

  it("cancels a pending export", async () => {
    const created = await post("/api/v1/exports", tok.root, {
      name: "to-cancel",
      scope: "audit_logs",
      format: "csv",
      reason: "will cancel this",
    });
    const id = created.body.id;
    const cancel = await post(`/api/v1/exports/${id}/cancel`, tok.root, { reason: "changed my mind" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
  });

  it("archives an export softly (row retained, artifact removed, not downloadable)", async () => {
    const created = await post("/api/v1/exports", tok.root, { name: "arch", scope: "institutions", format: "csv" });
    const id = created.body.id;
    expect(created.body.hasArtifact).toBe(true);

    const arch = await post(`/api/v1/exports/${id}/archive`, tok.root, { reason: "cleanup old export" });
    expect(arch.status).toBe(200);

    const row = await get(`/api/v1/exports/${id}`, tok.root);
    expect(row.status).toBe(200); // metadata row still exists
    expect(row.body.hasArtifact).toBe(false);
    expect(row.body.archivedAt).toBeTruthy();
    expect((await get(`/api/v1/exports/${id}/download?reason=nope`, tok.root)).status).toBe(400);
  });

  it("sweeps past-expiry exports to 'expired' and blocks their download", async () => {
    const created = await post("/api/v1/exports", tok.root, { name: "exp", scope: "institutions", format: "csv" });
    const id = created.body.id;
    await query("UPDATE platform_exports SET expires_at = now() - interval '1 day' WHERE id = $1", [id]);

    // Listing runs the sweep (like the backups sweeps).
    await get("/api/v1/exports", tok.root);
    const row = await get(`/api/v1/exports/${id}`, tok.root);
    expect(row.body.status).toBe("expired");
    expect(row.body.hasArtifact).toBe(false);
    expect((await get(`/api/v1/exports/${id}/download?reason=expired-try`, tok.root)).status).toBe(400);
  });

  it("generates a tenant data-portability pack (masked ZIP) and requires a reason", async () => {
    // Reason is mandatory (schema min 8).
    const noReason = await post("/api/v1/exports/portability", tok.root, { institutionId: instId });
    expect(noReason.status).toBe(400);

    const pack = await post("/api/v1/exports/portability", tok.root, {
      institutionId: instId,
      reason: "tenant offboarding data request",
    });
    expect(pack.status).toBe(201);
    expect(pack.body.status).toBe("completed");
    expect(pack.body.scope).toBe("portability_pack");
    expect(pack.body.format).toBe("zip");
    expect(pack.body.hasArtifact).toBe(true);
    expect(pack.body.fileCount).toBeGreaterThanOrEqual(7);
    const id = pack.body.id;

    const man = await get(`/api/v1/exports/${id}/manifest`, tok.root);
    expect(man.status).toBe(200);
    expect(Array.isArray(man.body.files)).toBe(true);
    expect(man.body.files.length).toBeGreaterThanOrEqual(7);
    expect(man.body.files.every((f: { sha256?: string }) => typeof f.sha256 === "string")).toBe(true);
    expect(JSON.stringify(man.body)).not.toMatch(SECRET_RE);

    const dl = await get(`/api/v1/exports/${id}/download?reason=deliver-the-pack`, tok.root).buffer(true);
    expect(dl.status).toBe(200);
    // A ZIP starts with the PK local-file-header magic.
    expect(bytesOf(dl).slice(0, 2).toString("latin1")).toBe("PK");
  });

  it("never leaks a tenant user's password hash into an artifact", async () => {
    // tenant_users is sensitive (reason required); a date filter keeps it off the
    // approval queue so it generates synchronously.
    const created = await post("/api/v1/exports", tok.root, {
      name: "user-roster",
      scope: "tenant_users",
      format: "csv",
      reason: "user roster export",
      filters: { dateFrom: "2000-01-01" },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("completed");
    const id = created.body.id;

    const dl = await get(`/api/v1/exports/${id}/download?reason=roster-review`, tok.root).buffer(true);
    expect(dl.status).toBe(200);
    const text = textOf(dl);
    expect(text).toContain("teacher@k.dev"); // the data is present...
    expect(text).not.toMatch(/\$2[aby]\$/); // ...but never the bcrypt hash
    expect(text).not.toMatch(SECRET_RE);
  });

  it("forbids a non-super-admin from the export center (RBAC 403)", async () => {
    for (const path of ["/api/v1/exports", "/api/v1/exports/summary", "/api/v1/exports/retention"]) {
      expect((await get(path, tok.tenant)).status).toBe(403);
    }
    expect((await post("/api/v1/exports", tok.tenant, { name: "x", scope: "institutions" })).status).toBe(403);
  });

  it("supports scheduled-export CRUD", async () => {
    const create = await post("/api/v1/exports/schedules", tok.root, {
      name: "Nightly institutions",
      scope: "institutions",
      format: "csv",
      frequency: "daily",
      runTime: "02:00",
    });
    expect(create.status).toBe(201);
    expect(create.body.nextRunAt).toBeTruthy();
    const id = create.body.id;

    const list = await get("/api/v1/exports/schedules", tok.root);
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    const upd = await patch(`/api/v1/exports/schedules/${id}`, tok.root, { enabled: false });
    expect(upd.status).toBe(200);
    expect(upd.body.enabled).toBe(false);
    expect(upd.body.nextRunAt).toBeNull(); // disabled → no next run

    const removed = await del(`/api/v1/exports/schedules/${id}`, tok.root);
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    expect((await get(`/api/v1/exports/schedules`, tok.root)).body.total).toBe(0);
  });

  it("reads and updates export retention defaults", async () => {
    const before = await get("/api/v1/exports/retention", tok.root);
    expect(before.status).toBe(200);
    expect(before.body.defaultRetentionDays).toBe(7);

    const upd = await patch("/api/v1/exports/retention", tok.root, {
      defaultRetentionDays: 14,
      sensitiveRetentionDays: 3,
    });
    expect(upd.status).toBe(200);
    expect(upd.body.defaultRetentionDays).toBe(14);
    expect(upd.body.sensitiveRetentionDays).toBe(3);
  });
});
