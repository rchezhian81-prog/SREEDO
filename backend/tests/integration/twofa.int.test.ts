import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";
import { generateTotp } from "../../src/utils/totp";

const ADMIN = { email: "admin@2fa.dev", password: "Passw0rd!" };

describe("two-factor authentication", () => {
  let token: string;
  let institutionId: string;

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution();
    await createUser({
      ...ADMIN,
      role: "admin",
      fullName: "Admin",
      institutionId,
    });
    token = await tokenFor(ADMIN.email, ADMIN.password);
  });

  /** Enroll the admin in 2FA and return the shared secret. */
  async function enroll(authToken = token): Promise<string> {
    const setup = await request(app)
      .post("/api/v1/auth/2fa/setup")
      .set("Authorization", `Bearer ${authToken}`);
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect(typeof secret).toBe("string");
    const enable = await request(app)
      .post("/api/v1/auth/2fa/enable")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ code: generateTotp(secret) });
    expect(enable.status).toBe(204);
    return secret;
  }

  it("enrolls and reports status enabled", async () => {
    await enroll();
    const status = await request(app)
      .get("/api/v1/auth/2fa/status")
      .set("Authorization", `Bearer ${token}`);
    expect(status.body.enabled).toBe(true);
  });

  it("requires a code at login once enabled (soft signal, no tokens)", async () => {
    await enroll();
    const res = await request(app).post("/api/v1/auth/login").send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.twoFactorRequired).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
  });

  it("rejects a wrong code and accepts a correct one", async () => {
    const secret = await enroll();
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...ADMIN, totpCode: "000000" });
    expect(wrong.status).toBe(401);
    const ok = await request(app)
      .post("/api/v1/auth/login")
      .send({ ...ADMIN, totpCode: generateTotp(secret) });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.accessToken).toBe("string");
  });

  it("enable rejects an invalid code (2FA stays off)", async () => {
    await request(app)
      .post("/api/v1/auth/2fa/setup")
      .set("Authorization", `Bearer ${token}`);
    const enable = await request(app)
      .post("/api/v1/auth/2fa/enable")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "000000" });
    expect(enable.status).toBe(400);
    const login = await request(app).post("/api/v1/auth/login").send(ADMIN);
    expect(typeof login.body.accessToken).toBe("string");
  });

  it("self-disables with the correct password", async () => {
    await enroll();
    const bad = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "wrong-password" });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: ADMIN.password });
    expect(ok.status).toBe(204);
    const login = await request(app).post("/api/v1/auth/login").send(ADMIN);
    expect(typeof login.body.accessToken).toBe("string");
  });

  it("lets an admin reset a user's 2FA for recovery", async () => {
    const staff = await createUser({
      email: "staff@2fa.dev",
      password: "Passw0rd!",
      role: "teacher",
      institutionId,
    });
    const staffToken = await tokenFor("staff@2fa.dev", "Passw0rd!");
    await enroll(staffToken);

    const needsCode = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@2fa.dev", password: "Passw0rd!" });
    expect(needsCode.body.twoFactorRequired).toBe(true);

    const reset = await request(app)
      .post(`/api/v1/users/${staff.id}/disable-2fa`)
      .set("Authorization", `Bearer ${token}`);
    expect(reset.status).toBe(204);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "staff@2fa.dev", password: "Passw0rd!" });
    expect(typeof login.body.accessToken).toBe("string");
  });
});
