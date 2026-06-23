import crypto from "node:crypto";
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

const ADMIN = { email: "admin@test.dev", password: "Passw0rd!" };

async function userIdByEmail(email: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );
  return rows[0].id;
}

/** Inserts a reset-token row directly (the raw token is normally only emailed). */
async function insertResetToken(
  userId: string,
  rawToken: string,
  expiresAt: Date
): Promise<void> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
}

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

  describe("password reset", () => {
    it("forgot-password returns 200 and stores a token for a real account", async () => {
      const res = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: ADMIN.email });
      expect(res.status).toBe(200);
      const userId = await userIdByEmail(ADMIN.email);
      const { rows } = await query(
        "SELECT * FROM password_reset_tokens WHERE user_id = $1",
        [userId]
      );
      expect(rows.length).toBe(1);
    });

    it("forgot-password does not reveal unknown emails (200, no token)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: "nobody@test.dev" });
      expect(res.status).toBe(200);
      const { rows } = await query("SELECT * FROM password_reset_tokens");
      expect(rows.length).toBe(0);
    });

    it("resets the password, revokes sessions, and is single-use", async () => {
      const userId = await userIdByEmail(ADMIN.email);
      // an active session that the reset must revoke
      const login = await request(app).post("/api/v1/auth/login").send(ADMIN);
      const oldRefresh = login.body.refreshToken as string;

      const rawToken = "reset-token-abc123";
      await insertResetToken(userId, rawToken, new Date(Date.now() + 3_600_000));

      const reset = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: rawToken, newPassword: "NewPassw0rd!" });
      expect(reset.status).toBe(204);

      // old password no longer works; the new one does
      const oldLogin = await request(app).post("/api/v1/auth/login").send(ADMIN);
      expect(oldLogin.status).toBe(401);
      const newLogin = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: ADMIN.email, password: "NewPassw0rd!" });
      expect(newLogin.status).toBe(200);

      // prior sessions were revoked
      const refreshed = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: oldRefresh });
      expect(refreshed.status).toBe(401);

      // the token is single-use
      const reuse = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: rawToken, newPassword: "AnotherPass1!" });
      expect(reuse.status).toBe(400);
    });

    it("rejects an unknown reset token (400)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: "does-not-exist", newPassword: "NewPassw0rd!" });
      expect(res.status).toBe(400);
    });

    it("rejects an expired reset token (400)", async () => {
      const userId = await userIdByEmail(ADMIN.email);
      const rawToken = "expired-token-xyz";
      await insertResetToken(userId, rawToken, new Date(Date.now() - 60_000));
      const res = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: rawToken, newPassword: "NewPassw0rd!" });
      expect(res.status).toBe(400);
    });

    it("enforces password strength on reset (400)", async () => {
      const userId = await userIdByEmail(ADMIN.email);
      const rawToken = "weak-pass-token";
      await insertResetToken(userId, rawToken, new Date(Date.now() + 3_600_000));
      const res = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: rawToken, newPassword: "short" });
      expect(res.status).toBe(400);
    });
  });
});
