import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("branding / white-labeling (/branding)", () => {
  let instA: string;
  let instB: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("BR");
    instB = await createInstitution("BR2");
    await createUser({ email: "admin@br.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@br.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "admin@br2.dev", password: PW, role: "admin", institutionId: instB });
    tok.admin = await tokenFor("admin@br.dev", PW);
    tok.teacher = await tokenFor("teacher@br.dev", PW);
    tok.adminB = await tokenFor("admin@br2.dev", PW);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/branding")).status).toBe(401);
  });

  it("returns defaults, lets an admin set branding, and any tenant user can read it", async () => {
    const initial = await request(app).get("/api/v1/branding").set(auth(tok.admin));
    expect(initial.status).toBe(200);
    expect(initial.body.displayName).toBeNull();

    const updated = await request(app)
      .patch("/api/v1/branding")
      .set(auth(tok.admin))
      .send({ displayName: "Green Valley School", primaryColor: "#1d4ed8", tagline: "Learn & Grow" });
    expect(updated.status).toBe(200);
    expect(updated.body.displayName).toBe("Green Valley School");
    expect(updated.body.primaryColor).toBe("#1d4ed8");

    // A teacher (non-admin) can read but not modify.
    const teacherRead = await request(app).get("/api/v1/branding").set(auth(tok.teacher));
    expect(teacherRead.body.displayName).toBe("Green Valley School");
    expect(
      (await request(app).patch("/api/v1/branding").set(auth(tok.teacher)).send({ displayName: "Hacked" })).status
    ).toBe(403);
  });

  it("rejects an invalid colour", async () => {
    const res = await request(app)
      .patch("/api/v1/branding")
      .set(auth(tok.admin))
      .send({ primaryColor: "blue" });
    expect(res.status).toBe(400);
  });

  it("isolates tenants", async () => {
    await request(app).patch("/api/v1/branding").set(auth(tok.admin)).send({ displayName: "A School" });
    const b = await request(app).get("/api/v1/branding").set(auth(tok.adminB));
    expect(b.body.displayName).toBeNull();
  });
});
