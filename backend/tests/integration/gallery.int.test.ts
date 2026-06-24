import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createInstitution, createUser, query, resetDb, tokenFor } from "./helpers";

const PW = "Passw0rd!";

describe("photo gallery (/gallery, /portal/gallery)", () => {
  let instA: string;
  let instB: string;
  let s1: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("GAL");
    instB = await createInstitution("GAL2");
    await createUser({ email: "admin@gal.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@gal2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@gal.dev", password: PW, role: "super_admin", institutionId: null });
    const s = await query<{ id: string }>(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'GAL-1', 'Ria', 'M') RETURNING id`,
      [instA]
    );
    s1 = s.rows[0].id;
    const studentUser = await createUser({ email: "stud@gal.dev", password: PW, role: "student", institutionId: instA });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [studentUser.id, s1]);

    tok.admin = await tokenFor("admin@gal.dev", PW);
    tok.adminB = await tokenFor("admin@gal2.dev", PW);
    tok.super = await tokenFor("super@gal.dev", PW);
    tok.student = await tokenFor("stud@gal.dev", PW);
  });

  it("requires auth + tenant + admin role for management", async () => {
    expect((await request(app).get("/api/v1/gallery/albums")).status).toBe(401);
    expect((await request(app).get("/api/v1/gallery/albums").set(auth(tok.super))).status).toBe(403);
    expect((await request(app).get("/api/v1/gallery/albums").set(auth(tok.student))).status).toBe(403);
  });

  it("creates an album, adds photos, publishes, and the portal shows it", async () => {
    const album = await request(app)
      .post("/api/v1/gallery/albums")
      .set(auth(tok.admin))
      .send({ title: "Sports Day 2026" });
    expect(album.status).toBe(201);
    const albumId = album.body.id as string;

    const withPhoto = await request(app)
      .post(`/api/v1/gallery/albums/${albumId}/photos`)
      .set(auth(tok.admin))
      .send({ imageUrl: "https://ex.com/1.jpg", caption: "Relay" });
    expect(withPhoto.status).toBe(201);
    expect(withPhoto.body.photos).toHaveLength(1);

    // Unpublished → portal sees nothing.
    let portal = await request(app).get("/api/v1/portal/gallery").set(auth(tok.student));
    expect(portal.body).toHaveLength(0);
    expect((await request(app).get(`/api/v1/portal/gallery/${albumId}`).set(auth(tok.student))).status).toBe(404);

    await request(app).patch(`/api/v1/gallery/albums/${albumId}`).set(auth(tok.admin)).send({ isPublished: true });

    portal = await request(app).get("/api/v1/portal/gallery").set(auth(tok.student));
    expect(portal.body).toHaveLength(1);
    expect(portal.body[0].photoCount).toBe(1);

    const detail = await request(app).get(`/api/v1/portal/gallery/${albumId}`).set(auth(tok.student));
    expect(detail.body.photos[0].imageUrl).toBe("https://ex.com/1.jpg");
  });

  it("isolates tenants", async () => {
    const album = await request(app).post("/api/v1/gallery/albums").set(auth(tok.admin)).send({ title: "Private" });
    const albumId = album.body.id as string;
    expect((await request(app).get(`/api/v1/gallery/albums/${albumId}`).set(auth(tok.adminB))).status).toBe(404);
  });
});
