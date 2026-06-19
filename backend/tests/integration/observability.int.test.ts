import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";
import { buildAccessLog } from "../../src/middleware/request-logger";
import { enqueue } from "../../src/modules/jobs/jobs.service";
import { processDueJobs } from "../../src/modules/jobs/jobs.worker";

const PW = "Passw0rd!";

/** Minimal Express req/res mocks for the pure log builder. */
function mockReq(over: Record<string, unknown> = {}): Request {
  return {
    requestId: "rid-123",
    method: "POST",
    originalUrl: "/api/v1/auth/login?token=SUPERSECRET",
    ip: "10.0.0.9",
    get: (h: string) => (h.toLowerCase() === "user-agent" ? "Mozilla/5.0" : undefined),
    ...over,
  } as unknown as Request;
}

describe("observability", () => {
  let instA: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t?: string) => (t ? request(app).get(p).set(auth(t)) : request(app).get(p));

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("OBS");
    await createUser({ email: "root@o.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@o.dev", PW);
    for (const role of ["admin", "student", "parent"] as const) {
      await createUser({ email: `${role}@o.dev`, password: PW, role, institutionId: instA });
      tok[role] = await tokenFor(`${role}@o.dev`, PW);
    }
  });

  it("generates and returns a correlation id", async () => {
    const res = await get("/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-request-id"].length).toBeGreaterThan(10);
  });

  it("preserves an incoming x-request-id", async () => {
    const res = await get("/health").set("x-request-id", "trace-abc-123");
    expect(res.headers["x-request-id"]).toBe("trace-abc-123");
  });

  it("builds a structured access log with only safe fields (no secrets, no query)", () => {
    const log = buildAccessLog(
      mockReq({ user: { id: "u1", institutionId: instA, role: "admin" } }),
      { statusCode: 200 } as Response,
      12
    );
    // Curated keys only.
    expect(Object.keys(log).sort()).toEqual(
      ["durationMs", "institutionId", "ip", "method", "path", "requestId", "role", "status", "userId", "userAgent"].sort()
    );
    // Query string (and any ?token=) is dropped.
    expect(log.path).toBe("/api/v1/auth/login");
    // Tenant/user context included safely.
    expect(log.userId).toBe("u1");
    expect(log.institutionId).toBe(instA);
    expect(log.role).toBe("admin");
    // No secret/credential material anywhere.
    expect(JSON.stringify(log)).not.toMatch(/SUPERSECRET|password|secret|token|authorization|bearer/i);
  });

  it("omits user context for anonymous requests", () => {
    const log = buildAccessLog(mockReq(), { statusCode: 401 } as Response, 3);
    expect(log.userId).toBeNull();
    expect(log.institutionId).toBeNull();
    expect(log.role).toBeNull();
  });

  it("serves a basic /health liveness status", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.postgres).toBe(true);
  });

  it("serves /ready with DB + migration readiness checks", async () => {
    const res = await get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.database).toBe(true);
    expect(res.body.checks.migrations).toBe(true);
    // No secrets in the readiness body.
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token/i);
  });

  it("exposes Prometheus metrics to super admin (request + job counters)", async () => {
    await get("/api/v1/observability/overview", tok.root); // generate some traffic
    const res = await get("/api/v1/observability/metrics", tok.root);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("http_requests_total");
    expect(res.text).toContain("jobs_processed_total");
    expect(res.text).toContain("jobs_queue_depth");
    expect(res.text).not.toMatch(/password|secret|token/i);
  });

  it("permission-gates the protected observability endpoints", async () => {
    for (const path of ["/api/v1/observability/metrics", "/api/v1/observability/health", "/api/v1/observability/overview"]) {
      expect((await get(path, tok.admin)).status).toBe(403); // tenant admin: no observability:*
      expect((await get(path, tok.student)).status).toBe(403);
      expect((await get(path, tok.parent)).status).toBe(403);
    }
  });

  it("increments job metrics on a permanent failure", async () => {
    const before = (await get("/api/v1/observability/overview", tok.root)).body.jobs.failed;
    await enqueue({ type: "does_not_exist", institutionId: instA, maxAttempts: 1 });
    await processDueJobs();
    const after = (await get("/api/v1/observability/overview", tok.root)).body.jobs.failed;
    expect(after).toBe(before + 1);
  });

  it("returns a detailed health view to super admin without secrets", async () => {
    const res = await get("/api/v1/observability/health", tok.root);
    expect(res.status).toBe(200);
    expect(res.body.postgres).toBe(true);
    expect(res.body.migrations).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("queue");
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token|key/i);
  });
});
