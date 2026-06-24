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
import { channelRecipients } from "../../src/modules/communication/communication.channels";

const PW = "Passw0rd!";

describe("notification preferences", () => {
  let institutionId: string;
  let userId: string;
  let token: string;

  const getPrefs = (t: string) =>
    request(app)
      .get("/api/v1/communication/preferences")
      .set("Authorization", `Bearer ${t}`);
  const patchPrefs = (t: string, body: unknown) =>
    request(app)
      .patch("/api/v1/communication/preferences")
      .set("Authorization", `Bearer ${t}`)
      .send(body);

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution("PREF");
    const u = await createUser({
      email: "u@pref.dev",
      password: PW,
      role: "teacher",
      institutionId,
    });
    userId = u.id;
    await query("UPDATE users SET phone = '+10000000000' WHERE id = $1", [
      userId,
    ]);
    token = await tokenFor("u@pref.dev", PW);
  });

  it("defaults to all channels enabled", async () => {
    const res = await getPrefs(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
    });
  });

  it("updates and persists; partial updates keep the rest", async () => {
    expect((await patchPrefs(token, { emailEnabled: false })).body).toMatchObject(
      { emailEnabled: false, smsEnabled: true, pushEnabled: true }
    );
    // Updating only sms must not reset the earlier email=false.
    expect((await patchPrefs(token, { smsEnabled: false })).body).toMatchObject({
      emailEnabled: false,
      smsEnabled: false,
      pushEnabled: true,
    });
    expect((await getPrefs(token)).body).toEqual({
      emailEnabled: false,
      smsEnabled: false,
      pushEnabled: true,
    });
  });

  it("rejects an empty update (400)", async () => {
    expect((await patchPrefs(token, {})).status).toBe(400);
  });

  it("channel resolution respects preferences", async () => {
    await query(
      `INSERT INTO device_tokens (institution_id, user_id, token) VALUES ($1, $2, 'tok-1')`,
      [institutionId, userId]
    );
    // Defaults — present in every channel.
    let r = await channelRecipients(institutionId, [userId]);
    expect(r.emails).toContain("u@pref.dev");
    expect(r.phones).toContain("+10000000000");
    expect(r.pushTokens).toContain("tok-1");

    await patchPrefs(token, { emailEnabled: false, pushEnabled: false });
    r = await channelRecipients(institutionId, [userId]);
    expect(r.emails).not.toContain("u@pref.dev");
    expect(r.phones).toContain("+10000000000"); // sms still enabled
    expect(r.pushTokens).not.toContain("tok-1");
  });

  it("keeps preferences independent per user", async () => {
    await createUser({
      email: "o@pref.dev",
      password: PW,
      role: "teacher",
      institutionId,
    });
    const otherToken = await tokenFor("o@pref.dev", PW);
    await patchPrefs(token, { emailEnabled: false });
    expect((await getPrefs(otherToken)).body).toEqual({
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
    });
  });
});
