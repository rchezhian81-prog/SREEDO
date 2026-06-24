import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  app,
  createInstitution,
  createUser,
  resetDb,
  tokenFor,
} from "./helpers";

const PW = "Passw0rd!";
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

describe("announcements: scheduling", () => {
  let institutionId: string;
  const tok: Record<string, string> = {};

  const post = (token: string, body: unknown) =>
    request(app)
      .post("/api/v1/announcements")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const list = (token: string) =>
    request(app)
      .get("/api/v1/announcements")
      .set("Authorization", `Bearer ${token}`);
  const getOne = (token: string, id: string) =>
    request(app)
      .get(`/api/v1/announcements/${id}`)
      .set("Authorization", `Bearer ${token}`);
  const patch = (token: string, id: string, body: unknown) =>
    request(app)
      .patch(`/api/v1/announcements/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const seen = (res: { body: { data: Array<{ id: string }> } }, id: string) =>
    res.body.data.some((a) => a.id === id);

  beforeEach(async () => {
    await resetDb();
    institutionId = await createInstitution("ANN");
    for (const role of ["admin", "teacher", "accountant", "student"] as const) {
      await createUser({
        email: `${role}@ann.dev`,
        password: PW,
        role,
        institutionId,
      });
      tok[role] = await tokenFor(`${role}@ann.dev`, PW);
    }
  });

  it("hides a scheduled announcement from the audience but shows it to publishers", async () => {
    const created = await post(tok.admin, {
      title: "Sports Day",
      body: "Coming soon",
      publishAt: FUTURE,
    });
    expect(created.status).toBe(201);
    expect(created.body.scheduled).toBe(true);
    const id = created.body.id as string;

    // Publishers (admin, teacher) see it.
    expect(seen(await list(tok.admin), id)).toBe(true);
    expect(seen(await list(tok.teacher), id)).toBe(true);
    // Audience (student, accountant) does not.
    expect(seen(await list(tok.student), id)).toBe(false);
    expect(seen(await list(tok.accountant), id)).toBe(false);
    // Nor can the audience fetch it directly…
    expect((await getOne(tok.student, id)).status).toBe(404);
    // …while a publisher can.
    expect((await getOne(tok.admin, id)).status).toBe(200);
  });

  it("publishes immediately when no publishAt is given", async () => {
    const created = await post(tok.admin, { title: "Now", body: "Live" });
    expect(created.body.scheduled).toBe(false);
    expect(seen(await list(tok.student), created.body.id)).toBe(true);
  });

  it("treats a past publishAt as already published", async () => {
    const created = await post(tok.admin, {
      title: "Old news",
      body: "x",
      publishAt: PAST,
    });
    expect(created.body.scheduled).toBe(false);
    expect(seen(await list(tok.student), created.body.id)).toBe(true);
  });

  it("can be rescheduled to publish now (becomes visible)", async () => {
    const created = await post(tok.admin, {
      title: "Later",
      body: "x",
      publishAt: FUTURE,
    });
    const id = created.body.id as string;
    expect(seen(await list(tok.student), id)).toBe(false);

    const updated = await patch(tok.admin, id, { publishAt: PAST });
    expect(updated.status).toBe(200);
    expect(updated.body.scheduled).toBe(false);
    expect(seen(await list(tok.student), id)).toBe(true);
  });

  it("keeps role guards — the audience cannot publish", async () => {
    expect((await post(tok.student, { title: "no", body: "no" })).status).toBe(
      403
    );
    expect(
      (await post(tok.accountant, { title: "no", body: "no" })).status
    ).toBe(403);
  });
});
