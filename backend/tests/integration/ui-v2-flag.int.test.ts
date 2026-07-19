import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import {
  evaluatePlatformFlag,
  __clearPlatformFeatureRuntimeCache,
} from "../../src/modules/platform/feature-flag-runtime";

// PR-UI2 — the `ui_v2` skin flag resolves from the AUDITED platform_feature_flags
// registry (Layer 2): effective ONLY when status='enabled' AND the caller's own
// institution is explicitly in allowed_tenants. Default/failure => false. /auth/me
// exposes only the derived boolean `uiV2Enabled` (never raw flag internals).

const PW = "Passw0rd!";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const me = (tok: string) => request(app).get("/api/v1/auth/me").set(auth(tok));

async function setUiV2Flag(status: string, allowed: string[]) {
  await query(`DELETE FROM platform_feature_flags WHERE key = 'ui_v2'`);
  await query(
    `INSERT INTO platform_feature_flags (key, display_name, status, scope, allowed_tenants)
     VALUES ('ui_v2', 'UI v2 skin', $1, 'tenant', $2::uuid[])`,
    [status, allowed]
  );
  __clearPlatformFeatureRuntimeCache();
}

describe("PR-UI2 ui_v2 resolver — pure logic (enabled + explicit allow-list only)", () => {
  const T = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";
  it("false: missing flag row", () => expect(evaluatePlatformFlag(null, T)).toBe(false));
  it("false: disabled even if allow-listed", () =>
    expect(evaluatePlatformFlag({ status: "disabled", allowed: [T] }, T)).toBe(false));
  it("false: rollout status (explicit allow-list only)", () =>
    expect(evaluatePlatformFlag({ status: "rollout", allowed: [T] }, T)).toBe(false));
  it("false: enabled but tenant not allow-listed", () =>
    expect(evaluatePlatformFlag({ status: "enabled", allowed: [OTHER] }, T)).toBe(false));
  it("false: enabled but empty allow-list", () =>
    expect(evaluatePlatformFlag({ status: "enabled", allowed: [] }, T)).toBe(false));
  it("false: missing institution id", () => {
    expect(evaluatePlatformFlag({ status: "enabled", allowed: [T] }, null)).toBe(false);
    expect(evaluatePlatformFlag({ status: "enabled", allowed: [T] }, "")).toBe(false);
  });
  it("true: enabled AND tenant explicitly allow-listed", () =>
    expect(evaluatePlatformFlag({ status: "enabled", allowed: [OTHER, T] }, T)).toBe(true));
});

describe("PR-UI2 ui_v2 flag via /auth/me (DB-backed, tenant-isolated)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    await query(`DELETE FROM platform_feature_flags WHERE key = 'ui_v2'`);
    instA = await createInstitution("UVA", "school");
    instB = await createInstitution("UVB", "school");
    await createUser({ email: "a@uv.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "b@uv.dev", password: PW, role: "admin", institutionId: instB });
    tok.a = await tokenFor("a@uv.dev", PW);
    tok.b = await tokenFor("b@uv.dev", PW);
    __clearPlatformFeatureRuntimeCache();
  });

  it("defaults uiV2Enabled=false when no ui_v2 flag row exists", async () => {
    const r = await me(tok.a);
    expect(r.status).toBe(200);
    expect(r.body.uiV2Enabled).toBe(false);
  });

  it("stays false when the flag exists but is disabled (even if allow-listed)", async () => {
    await setUiV2Flag("disabled", [instA]);
    expect((await me(tok.a)).body.uiV2Enabled).toBe(false);
  });

  it("is true ONLY for an enabled flag with the tenant explicitly allow-listed", async () => {
    await setUiV2Flag("enabled", [instA]);
    expect((await me(tok.a)).body.uiV2Enabled).toBe(true);
  });

  it("enforces tenant isolation — an allow-listed tenant never enables another", async () => {
    await setUiV2Flag("enabled", [instA]);
    expect((await me(tok.a)).body.uiV2Enabled).toBe(true);
    expect((await me(tok.b)).body.uiV2Enabled).toBe(false);
  });

  it("never leaks raw flag internals (allowed_tenants / settings) on /auth/me", async () => {
    await setUiV2Flag("enabled", [instA]);
    const body = (await me(tok.a)).body;
    expect(typeof body.uiV2Enabled).toBe("boolean");
    const json = JSON.stringify(body);
    expect(json).not.toContain("allowed_tenants");
    expect(json).not.toContain("allowedTenants");
    expect(json).not.toContain(instB); // no other tenant id leaks
    expect(body).not.toHaveProperty("featureFlags");
    expect(body).not.toHaveProperty("settings");
  });
});
