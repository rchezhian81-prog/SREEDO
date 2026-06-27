import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

function binaryParser(res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("custom report builder", () => {
  let instA: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, body?: unknown) =>
    request(app).post(p).set(auth(t)).send(body as object);
  const patch = (p: string, t: string, body?: unknown) =>
    request(app).patch(p).set(auth(t)).send(body as object);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  const newReport = (t: string, over: Record<string, unknown> = {}) =>
    post("/api/v1/custom-reports", t, {
      name: "My Roster",
      reportKey: "students",
      columns: ["name", "class"],
      filters: {},
      visibility: "private",
      ...over,
    });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CRB");
    for (const role of ["admin", "accountant", "teacher", "student", "parent"] as const) {
      await createUser({ email: `${role}@crb.dev`, password: PW, role, institutionId: instA });
      tok[role] = await tokenFor(`${role}@crb.dev`, PW);
    }
  });

  it("creates, edits, duplicates and deletes a saved report", async () => {
    const created = await newReport(tok.admin);
    expect(created.status).toBe(201);
    expect(created.body.reportKey).toBe("students");
    expect(created.body.columns).toEqual(["name", "class"]);
    const id = created.body.id;

    expect((await patch(`/api/v1/custom-reports/${id}`, tok.admin, { name: "Renamed" })).body.name).toBe("Renamed");

    const dup = await post(`/api/v1/custom-reports/${id}/duplicate`, tok.admin);
    expect(dup.status).toBe(201);
    expect(dup.body.id).not.toBe(id);
    expect(dup.body.name).toBe("Copy of Renamed");
    expect(dup.body.visibility).toBe("private");

    expect((await del(`/api/v1/custom-reports/${id}`, tok.admin)).status).toBe(204);
    expect((await get(`/api/v1/custom-reports/${id}`, tok.admin)).status).toBe(404);
  });

  it("runs a saved report with column projection", async () => {
    const id = (await newReport(tok.admin)).body.id;
    const run = await get(`/api/v1/custom-reports/${id}/run`, tok.admin);
    expect(run.status).toBe(200);
    expect(run.body.columns.map((c: { key: string }) => c.key)).toEqual(["name", "class"]);
    expect(Array.isArray(run.body.rows)).toBe(true);
  });

  it("previews an ad-hoc report without saving", async () => {
    const res = await post("/api/v1/custom-reports/preview", tok.admin, {
      reportKey: "students",
      columns: ["name"],
    });
    expect(res.status).toBe(200);
    expect(res.body.columns).toHaveLength(1);
    expect(res.body.columns[0].key).toBe("name");
  });

  it("exports saved reports to CSV and PDF", async () => {
    const id = (await newReport(tok.admin)).body.id;
    const csv = await get(`/api/v1/custom-reports/${id}/export?format=csv`, tok.admin);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Name");

    const pdf = await get(`/api/v1/custom-reports/${id}/export?format=pdf`, tok.admin)
      .buffer(true)
      .parse(binaryParser);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("enforces shared/private access and the share permission", async () => {
    // accountant lacks custom_reports:share → cannot create a shared report.
    expect((await newReport(tok.accountant, { visibility: "shared" })).status).toBe(403);
    expect((await newReport(tok.accountant, { visibility: "private" })).status).toBe(201);

    // admin's private report is invisible to others.
    const priv = (await newReport(tok.admin, { name: "Private" })).body.id;
    expect((await get(`/api/v1/custom-reports/${priv}`, tok.accountant)).status).toBe(404);
    expect((await get("/api/v1/custom-reports", tok.accountant)).body.some((r: { id: string }) => r.id === priv)).toBe(false);

    // admin's shared report is visible to others with read.
    const shared = (await newReport(tok.admin, { name: "Shared", visibility: "shared" })).body.id;
    expect((await get(`/api/v1/custom-reports/${shared}`, tok.accountant)).status).toBe(200);
    expect((await get("/api/v1/custom-reports", tok.accountant)).body.some((r: { id: string }) => r.id === shared)).toBe(true);
  });

  it("enforces the underlying report's permission when running", async () => {
    // fee_outstanding requires fee_reports:read (admin/accountant, NOT teacher).
    const shared = (await newReport(tok.admin, {
      name: "Dues", reportKey: "fee_outstanding", columns: [], visibility: "shared",
    })).body.id;

    expect((await get(`/api/v1/custom-reports/${shared}/run`, tok.teacher)).status).toBe(403);
    expect((await get(`/api/v1/custom-reports/${shared}/run`, tok.accountant)).status).toBe(200);
    // ad-hoc on a source you lack permission for is also blocked.
    expect((await post("/api/v1/custom-reports/preview", tok.teacher, { reportKey: "fee_outstanding" })).status).toBe(403);
  });

  it("blocks students/parents from the report builder", async () => {
    expect((await get("/api/v1/custom-reports", tok.student)).status).toBe(403);
    expect((await newReport(tok.student)).status).toBe(403);
    expect((await post("/api/v1/custom-reports/preview", tok.parent, { reportKey: "students" })).status).toBe(403);
  });

  it("is tenant-isolated and denies cross-institution access", async () => {
    const id = (await newReport(tok.admin, { visibility: "shared" })).body.id;

    const instB = await createInstitution("CRB2");
    await createUser({ email: "admin@crb2.dev", password: PW, role: "admin", institutionId: instB });
    const bAdmin = await tokenFor("admin@crb2.dev", PW);

    expect((await get("/api/v1/custom-reports", bAdmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/custom-reports/${id}`, bAdmin)).status).toBe(404);
    expect((await get(`/api/v1/custom-reports/${id}/run`, bAdmin)).status).toBe(404);
  });
});
