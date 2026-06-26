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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("institution-type guards (school vs college)", () => {
  let schoolTok: string;
  let collegeTok: string;

  beforeEach(async () => {
    await resetDb();
    const school = await createInstitution("SCH", "school");
    const college = await createInstitution("CLG", "college");
    await createUser({ email: "admin@sch.dev", password: PW, role: "admin", institutionId: school });
    await createUser({ email: "admin@clg.dev", password: PW, role: "admin", institutionId: college });
    schoolTok = await tokenFor("admin@sch.dev", PW);
    collegeTok = await tokenFor("admin@clg.dev", PW);
  });

  it("exposes the institution type on /auth/me", async () => {
    const s = await request(app).get("/api/v1/auth/me").set(auth(schoolTok));
    expect(s.status).toBe(200);
    expect(s.body.institutionType).toBe("school");

    const c = await request(app).get("/api/v1/auth/me").set(auth(collegeTok));
    expect(c.body.institutionType).toBe("college");
  });

  it("allows class creation for schools but blocks it for colleges", async () => {
    const ok = await request(app)
      .post("/api/v1/classes")
      .set(auth(schoolTok))
      .send({ name: "Grade 5", gradeLevel: 5 });
    expect(ok.status).toBe(201);

    const blocked = await request(app)
      .post("/api/v1/classes")
      .set(auth(collegeTok))
      .send({ name: "Grade 5", gradeLevel: 5 });
    expect(blocked.status).toBe(403);
  });

  it("allows college structures for colleges but blocks them for schools", async () => {
    const ok = await request(app)
      .post("/api/v1/college/departments")
      .set(auth(collegeTok))
      .send({ name: "Computer Science", code: "CS" });
    expect(ok.status).toBe(201);

    // The type guard runs before the permission check, so a school is refused.
    const blocked = await request(app)
      .get("/api/v1/college/departments")
      .set(auth(schoolTok));
    expect(blocked.status).toBe(403);
  });

  it("lets a school switch to college, busting the type cache immediately", async () => {
    // Cache the school type via a (refused) college call first.
    const before = await request(app)
      .post("/api/v1/college/departments")
      .set(auth(schoolTok))
      .send({ name: "Mechanical", code: "ME" });
    expect(before.status).toBe(403);

    const flip = await request(app)
      .patch("/api/v1/college/settings")
      .set(auth(schoolTok))
      .send({ type: "college" });
    expect(flip.status).toBe(200);

    // Same tenant, now a college: the cached "school" entry must have been busted.
    const after = await request(app)
      .post("/api/v1/college/departments")
      .set(auth(schoolTok))
      .send({ name: "Mechanical", code: "ME" });
    expect(after.status).toBe(201);

    const me = await request(app).get("/api/v1/auth/me").set(auth(schoolTok));
    expect(me.body.institutionType).toBe("college");
  });
});
