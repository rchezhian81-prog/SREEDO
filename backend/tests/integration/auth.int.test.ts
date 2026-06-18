import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";

const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };

describe("auth & protected routes", () => {
  beforeEach(async () => {
    await resetDb();
    const institutionId = await createInstitution();
    await createUser({ ...ADMIN, role: "admin", fullName: "Admin", institutionId });
  });

  it("rejects unauthenticated access to a protected route", async () => {
    const res = await request(app).get("/api/v1/students");
    expect(res.status).toBe(401);
    expect(typeof res.body.error).toBe("string");
  });

  it("logs in and reaches a protected route with the token", async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .get("/api/v1/students")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await request(app)
      .get("/api/v1/students")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("rejects invalid credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN.email, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("validates the login body (400 on missing fields)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("returns the current profile from /auth/me", async () => {
    const token = await tokenFor(ADMIN.email, ADMIN.password);
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN.email);
    expect(res.body.role).toBe("admin");
  });

  it("rotates refresh tokens and detects reuse", async () => {
    const login = await request(app).post("/api/v1/auth/login").send(ADMIN);
    const original = login.body.refreshToken as string;

    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: original });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(original);

    // Reusing the original (now revoked) token is detected as theft.
    const reuse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: original });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toMatch(/reuse detected/i);

    // The whole family is revoked, so the rotated token is now invalid too.
    const after = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: rotated.body.refreshToken });
    expect(after.status).toBe(401);
  });
});
