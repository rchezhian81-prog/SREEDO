import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";
import { env } from "../../src/config/env";

const PW = "Passw0rd!";
const ADMIN = { email: "admin@lock.dev", password: PW };
const VICTIM = { email: "victim@lock.dev", password: PW };

const login = (email: string, password: string) =>
  request(app).post("/api/v1/auth/login").send({ email, password });

describe("per-account lockout", () => {
  let adminToken: string;
  let institutionId: string;
  let victimId: string;

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution("LOCK");
    await createUser({ ...ADMIN, role: "admin", institutionId });
    const victim = await createUser({ ...VICTIM, role: "teacher", institutionId });
    victimId = victim.id;
    adminToken = await tokenFor(ADMIN.email, ADMIN.password);
  });

  /** Make `times` failed password attempts (each expected to be 401). */
  async function failLogin(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      const res = await login(VICTIM.email, "wrong-password");
      expect(res.status).toBe(401);
    }
  }

  const unlock = (id: string, token: string) =>
    request(app)
      .post(`/api/v1/users/${id}/unlock`)
      .set("Authorization", `Bearer ${token}`);

  const usersList = (token: string) =>
    request(app)
      .get("/api/v1/users?limit=50")
      .set("Authorization", `Bearer ${token}`);

  it("locks after the configured number of failed attempts", async () => {
    await failLogin(env.authMaxFailedAttempts);
    // Even the correct password is now rejected with 423 Locked.
    expect((await login(VICTIM.email, VICTIM.password)).status).toBe(423);
  });

  it("stays unlocked below the threshold and a correct login resets the counter", async () => {
    await failLogin(env.authMaxFailedAttempts - 1);
    // Under the threshold the correct password works and clears the counter…
    expect((await login(VICTIM.email, VICTIM.password)).status).toBe(200);
    // …so another (threshold - 1) failures still do not lock the account.
    await failLogin(env.authMaxFailedAttempts - 1);
    expect((await login(VICTIM.email, VICTIM.password)).status).toBe(200);
  });

  it("lets an admin unlock a locked account", async () => {
    await failLogin(env.authMaxFailedAttempts);
    expect((await login(VICTIM.email, VICTIM.password)).status).toBe(423);

    expect((await unlock(victimId, adminToken)).status).toBe(204);
    expect((await login(VICTIM.email, VICTIM.password)).status).toBe(200);
  });

  it("surfaces lock status on the users list and clears it on unlock", async () => {
    await failLogin(env.authMaxFailedAttempts);
    const before = await usersList(adminToken);
    expect(
      before.body.data.find((u: { id: string }) => u.id === victimId).isLocked
    ).toBe(true);

    await unlock(victimId, adminToken);

    const after = await usersList(adminToken);
    expect(
      after.body.data.find((u: { id: string }) => u.id === victimId).isLocked
    ).toBe(false);
  });

  it("scopes unlock to the tenant and to admins", async () => {
    // An admin from another institution cannot unlock this user.
    const instB = await createInstitution("LOCKB");
    await createUser({
      email: "admin-b@lock.dev",
      password: PW,
      role: "admin",
      institutionId: instB,
    });
    const bToken = await tokenFor("admin-b@lock.dev", PW);
    expect((await unlock(victimId, bToken)).status).toBe(404);

    // A non-admin (the teacher) lacks users:manage and is forbidden.
    const victimToken = await tokenFor(VICTIM.email, VICTIM.password);
    expect((await unlock(victimId, victimToken)).status).toBe(403);
  });
});
