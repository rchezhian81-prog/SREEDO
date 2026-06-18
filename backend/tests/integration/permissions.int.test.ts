import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUser, resetDb, tokenFor } from "./helpers";

const USERS = {
  admin: { email: "admin@test.dev", password: "Passw0rd!" },
  teacher: { email: "teacher@test.dev", password: "Passw0rd!" },
  accountant: { email: "accountant@test.dev", password: "Passw0rd!" },
  super: { email: "super@test.dev", password: "Passw0rd!" },
} as const;

describe("permissions layer", () => {
  const tok: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    await createUser({ ...USERS.admin, role: "admin" });
    await createUser({ ...USERS.teacher, role: "teacher" });
    await createUser({ ...USERS.accountant, role: "accountant" });
    await createUser({ ...USERS.super, role: "super_admin" });
    tok.admin = await tokenFor(USERS.admin.email, USERS.admin.password);
    tok.teacher = await tokenFor(USERS.teacher.email, USERS.teacher.password);
    tok.accountant = await tokenFor(USERS.accountant.email, USERS.accountant.password);
    tok.super = await tokenFor(USERS.super.email, USERS.super.password);
  });

  const perms = async (token: string): Promise<string[]> => {
    const res = await request(app)
      .get("/api/v1/auth/permissions")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.permissions as string[];
  };

  it("returns the seeded permission matrix per role", async () => {
    expect(await perms(tok.admin)).toEqual(
      expect.arrayContaining(["users:manage", "students:create", "fees:manage"])
    );

    const teacher = await perms(tok.teacher);
    expect(teacher).toEqual(
      expect.arrayContaining(["attendance:mark", "exams:manage"])
    );
    expect(teacher).not.toContain("users:manage");

    const accountant = await perms(tok.accountant);
    expect(accountant).toEqual(
      expect.arrayContaining(["fees:manage", "fees:summary"])
    );
    expect(accountant).not.toContain("students:create");
  });

  it("grants super_admin every permission", async () => {
    const sup = await perms(tok.super);
    expect(sup).toEqual(
      expect.arrayContaining(["users:manage", "fees:manage", "students:create"])
    );
  });

  it("enforces requirePermission on the users route", async () => {
    const denied = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${tok.teacher}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${tok.admin}`);
    expect(allowed.status).toBe(200);
  });

  it("still requires authentication for guarded routes", async () => {
    const res = await request(app).get("/api/v1/users");
    expect(res.status).toBe(401);
  });
});
