import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// These tests build the app under different NODE_ENV / ENABLE_API_DOCS values by
// re-importing it with a reset module registry. They assert only on routes that
// don't touch the database. This file runs in its own worker (fileParallelism is
// off + per-file isolation), so the env mutations don't leak to other suites.
describe("Swagger docs gating", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_API_DOCS: process.env.ENABLE_API_DOCS,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  };

  afterAll(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.ENABLE_API_DOCS === undefined) delete process.env.ENABLE_API_DOCS;
    else process.env.ENABLE_API_DOCS = saved.ENABLE_API_DOCS;
    process.env.JWT_ACCESS_SECRET = saved.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = saved.JWT_REFRESH_SECRET;
    vi.resetModules();
  });

  async function freshApp() {
    vi.resetModules();
    const { createApp } = await import("../../src/app");
    return createApp();
  }

  it("serves the OpenAPI spec when docs are enabled", async () => {
    process.env.NODE_ENV = "test";
    process.env.ENABLE_API_DOCS = "true";
    const res = await request(await freshApp()).get("/api/docs.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi ?? res.body.swagger).toBeTruthy();
  });

  it("disables docs in production by default", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "prod-access-not-dev-secret";
    process.env.JWT_REFRESH_SECRET = "prod-refresh-not-dev-secret";
    delete process.env.ENABLE_API_DOCS;
    const res = await request(await freshApp()).get("/api/docs.json");
    expect(res.status).toBe(404);
  });

  it("can be force-enabled in production via ENABLE_API_DOCS", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_ACCESS_SECRET = "prod-access-not-dev-secret";
    process.env.JWT_REFRESH_SECRET = "prod-refresh-not-dev-secret";
    process.env.ENABLE_API_DOCS = "true";
    const res = await request(await freshApp()).get("/api/docs.json");
    expect(res.status).toBe(200);
  });
});
