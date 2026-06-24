import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb } from "./helpers";

const PW = "Passw0rd!";
const USER = { email: "user@sess.dev", password: PW };

interface SessionRow {
  id: string;
  userAgent: string | null;
  current: boolean;
}

describe("active sessions", () => {
  let institutionId: string;

  const loginAs = (ua: string, creds = USER) =>
    request(app).post("/api/v1/auth/login").set("User-Agent", ua).send(creds);

  const sessionsFor = (accessToken: string) =>
    request(app)
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${accessToken}`);

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution("SESS");
    await createUser({ ...USER, role: "admin", institutionId });
  });

  it("lists the caller's session and flags the current one", async () => {
    const login = await loginAs("Device-A");
    expect(login.status).toBe(200);

    const sessions = await sessionsFor(login.body.accessToken);
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(1);
    expect(sessions.body[0]).toMatchObject({
      userAgent: "Device-A",
      current: true,
    });
  });

  it("shows multiple sessions and signs out another device", async () => {
    const a = await loginAs("Device-A");
    const b = await loginAs("Device-B");

    const list = await sessionsFor(a.body.accessToken);
    expect(list.body).toHaveLength(2);
    const aRow = list.body.find((s: SessionRow) => s.userAgent === "Device-A");
    const bRow = list.body.find((s: SessionRow) => s.userAgent === "Device-B");
    expect(aRow.current).toBe(true);
    expect(bRow.current).toBe(false);

    // A signs out B.
    const revoke = await request(app)
      .delete(`/api/v1/auth/sessions/${bRow.id}`)
      .set("Authorization", `Bearer ${a.body.accessToken}`);
    expect(revoke.status).toBe(204);

    // B's refresh token no longer works.
    const refreshB = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: b.body.refreshToken });
    expect(refreshB.status).toBe(401);

    // Only A remains.
    const after = await sessionsFor(a.body.accessToken);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].userAgent).toBe("Device-A");
  });

  it("keeps a single current session across refresh rotation", async () => {
    const a = await loginAs("Device-A");
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("User-Agent", "Device-A")
      .send({ refreshToken: a.body.refreshToken });
    expect(refreshed.status).toBe(200);

    const list = await sessionsFor(refreshed.body.accessToken);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      userAgent: "Device-A",
      current: true,
    });
  });

  it("cannot revoke an unknown or another user's session (404)", async () => {
    const a = await loginAs("Device-A");
    const unknown = "11111111-1111-1111-1111-111111111111";
    expect(
      (
        await request(app)
          .delete(`/api/v1/auth/sessions/${unknown}`)
          .set("Authorization", `Bearer ${a.body.accessToken}`)
      ).status
    ).toBe(404);

    await createUser({
      email: "other@sess.dev",
      password: PW,
      role: "teacher",
      institutionId,
    });
    const other = await loginAs("Device-Other", {
      email: "other@sess.dev",
      password: PW,
    });
    const otherSessionId = (await sessionsFor(other.body.accessToken)).body[0]
      .id as string;

    expect(
      (
        await request(app)
          .delete(`/api/v1/auth/sessions/${otherSessionId}`)
          .set("Authorization", `Bearer ${a.body.accessToken}`)
      ).status
    ).toBe(404);
    // The other user's session is untouched.
    expect((await sessionsFor(other.body.accessToken)).body).toHaveLength(1);
  });
});
