import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";
import { swaggerSpec } from "../../src/config/swagger";

// API contract tests: the generated OpenAPI document must be structurally sound and
// cover the important API groups, and the live API must conform to it (documented
// status codes) and uphold the security guarantees (authn/authz, tenant + owner
// isolation). Runs in the normal integration suite — no extra services.

interface Operation {
  responses?: Record<string, { description?: string }>;
  tags?: string[];
  security?: unknown[];
}
type Paths = Record<string, Record<string, Operation>>;

const spec = swaggerSpec as unknown as {
  openapi: string;
  info: { title: string; version: string };
  paths: Paths;
  components?: { securitySchemes?: Record<string, unknown> };
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const PW = "Passw0rd!";

/** Documented response status codes for an operation (e.g. ["200","404"]). */
function documentedStatuses(pathKey: string, method: string): string[] {
  const op = spec.paths[pathKey]?.[method];
  return op?.responses ? Object.keys(op.responses) : [];
}

describe("OpenAPI contract — document structure", () => {
  it("is a valid OpenAPI 3.x document with metadata and a bearer security scheme", () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(100);
    expect(spec.components?.securitySchemes?.bearerAuth).toBeTruthy();
  });

  it("documents every important API group", () => {
    const paths = Object.keys(spec.paths);
    const has = (prefix: string) => paths.some((p) => p === prefix || p.startsWith(prefix));
    for (const group of [
      "/auth/login",
      "/students",
      "/teachers",
      "/attendance",
      "/fees",
      "/report-center",
      "/documents",
      "/homework",
      "/communication",
      "/portal",
      "/platform/permissions",
    ]) {
      expect(has(group), `OpenAPI is missing the ${group} group`).toBe(true);
    }
  });

  it("declares described, well-formed responses on every operation", () => {
    const offenders: string[] = [];
    for (const [pathKey, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!HTTP_METHODS.includes(method)) continue;
        const codes = Object.keys(op.responses ?? {});
        if (codes.length === 0) {
          offenders.push(`${method.toUpperCase()} ${pathKey}: no responses`);
          continue;
        }
        for (const code of codes) {
          if (!/^(\d{3}|default)$/.test(code)) {
            offenders.push(`${method.toUpperCase()} ${pathKey}: bad status "${code}"`);
          }
        }
      }
    }
    expect(offenders, offenders.slice(0, 10).join(" | ")).toEqual([]);
  });
});

describe("API contract — live conformance + security", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  let studentA1: string;
  let studentA2: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const createStudent = async (token: string, first: string) => {
    const res = await request(app)
      .post("/api/v1/students")
      .set(auth(token))
      .send({ firstName: first, lastName: "Contract" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("CONA");
    instB = await createInstitution("CONB");
    await createUser({ email: "root@con.dev", password: PW, role: "super_admin", institutionId: null });
    tok.root = await tokenFor("root@con.dev", PW);
    await createUser({ email: "admin-a@con.dev", password: PW, role: "admin", institutionId: instA });
    tok.adminA = await tokenFor("admin-a@con.dev", PW);
    await createUser({ email: "admin-b@con.dev", password: PW, role: "admin", institutionId: instB });
    tok.adminB = await tokenFor("admin-b@con.dev", PW);
    await createUser({ email: "teacher@con.dev", password: PW, role: "teacher", institutionId: instA });
    tok.teacher = await tokenFor("teacher@con.dev", PW);

    studentA1 = await createStudent(tok.adminA, "Aaron");
    studentA2 = await createStudent(tok.adminA, "Bella");

    // A student-role user linked to studentA1 (for owner-scope checks).
    const kid = await createUser({ email: "kid@con.dev", password: PW, role: "student", institutionId: instA });
    await query("UPDATE students SET user_id = $1 WHERE id = $2", [kid.id, studentA1]);
    tok.kid = await tokenFor("kid@con.dev", PW);
  });

  it("returns documented status codes for representative endpoints", async () => {
    const cases: Array<{ method: string; pathKey: string; url: string; token: string }> = [
      { method: "get", pathKey: "/students", url: "/api/v1/students", token: tok.adminA },
      { method: "get", pathKey: "/teachers", url: "/api/v1/teachers", token: tok.adminA },
      { method: "get", pathKey: "/dashboard/stats", url: "/api/v1/dashboard/stats", token: tok.adminA },
      { method: "get", pathKey: "/fees/summary", url: "/api/v1/fees/summary", token: tok.adminA },
      { method: "get", pathKey: "/attendance", url: "/api/v1/attendance", token: tok.adminA },
      { method: "get", pathKey: "/platform/permissions", url: "/api/v1/platform/permissions", token: tok.root },
    ];
    for (const c of cases) {
      const res = await request(app).get(c.url).set(auth(c.token));
      const documented = documentedStatuses(c.pathKey, c.method);
      expect(documented.length, `${c.pathKey} has no documented responses`).toBeGreaterThan(0);
      expect(documented, `${c.method.toUpperCase()} ${c.pathKey} returned ${res.status}`).toContain(
        String(res.status)
      );
    }
  });

  it("blocks unauthenticated access to protected endpoints (401)", async () => {
    for (const url of ["/api/v1/students", "/api/v1/dashboard/stats", "/api/v1/platform/permissions"]) {
      expect((await request(app).get(url)).status).toBe(401);
    }
  });

  it("enforces role/permission boundaries (403)", async () => {
    // Tenant admin cannot reach the super-admin platform surface.
    expect((await request(app).get("/api/v1/platform/permissions").set(auth(tok.adminA))).status).toBe(403);
    // Teacher cannot enroll students (admin-only).
    const res = await request(app)
      .post("/api/v1/students")
      .set(auth(tok.teacher))
      .send({ firstName: "No", lastName: "Way" });
    expect(res.status).toBe(403);
  });

  it("keeps tenants isolated (cross-tenant read is 404)", async () => {
    const otherStudent = await createStudent(tok.adminB, "Other");
    expect((await request(app).get(`/api/v1/students/${otherStudent}`).set(auth(tok.adminA))).status).toBe(404);
  });

  it("owner-scopes a student to their own record (cross-student is 403)", async () => {
    // The linked student can read their own record…
    expect((await request(app).get(`/api/v1/students/${studentA1}`).set(auth(tok.kid))).status).toBe(200);
    // …but not another student in the same institution.
    expect((await request(app).get(`/api/v1/students/${studentA2}`).set(auth(tok.kid))).status).toBe(403);
  });

  it("supports the portal API contract (cookie auth)", async () => {
    // A parent linked to studentA1.
    const parent = await createUser({ email: "parent@con.dev", password: PW, role: "parent", institutionId: instA });
    await query(
      "INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')",
      [instA, parent.id, studentA1]
    );
    // Portal uses cookie auth — an agent preserves the session cookie.
    const agent = request.agent(app);
    const login = await agent.post("/api/v1/auth/portal/login").send({ email: "parent@con.dev", password: PW });
    expect(login.status).toBe(200);
    const children = await agent.get("/api/v1/portal/children");
    expect(children.status).toBe(200);
    expect(Array.isArray(children.body)).toBe(true);
    expect(children.body.some((c: { id: string }) => c.id === studentA1)).toBe(true);
    // Unauthenticated portal access is rejected.
    expect((await request(app).get("/api/v1/portal/children")).status).toBe(401);
  });
});
