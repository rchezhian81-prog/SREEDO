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

const PW = "Passw0rd!";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await query<{ id: string }>(sql, params);
  return rows[0].id;
}

describe("library reservations (/reservations, /portal)", () => {
  let instA: string;
  let instB: string;
  let bookId: string;
  let book2: string;
  let s1: string;
  const tok: Record<string, string> = {};
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("RSV");
    instB = await createInstitution("RSV2");

    await createUser({ email: "admin@rsv.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "admin@rsv2.dev", password: PW, role: "admin", institutionId: instB });
    await createUser({ email: "super@rsv.dev", password: PW, role: "super_admin", institutionId: null });

    bookId = await insertId(
      `INSERT INTO books (institution_id, title, author) VALUES ($1, 'Wings of Fire', 'A. Kalam') RETURNING id`,
      [instA]
    );
    book2 = await insertId(
      `INSERT INTO books (institution_id, title, author) VALUES ($1, 'Panchatantra', 'Vishnu Sharma') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO book_copies (institution_id, book_id, accession_number, status) VALUES ($1, $2, 'ACC-1', 'available')`,
      [instA, bookId]
    );

    s1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1, 'RSV-1', 'Kavya', 'M') RETURNING id`,
      [instA]
    );
    const studentUser = await createUser({
      email: "stud@rsv.dev", password: PW, role: "student", institutionId: instA,
    });
    await query(`UPDATE students SET user_id = $1 WHERE id = $2`, [studentUser.id, s1]);

    tok.admin = await tokenFor("admin@rsv.dev", PW);
    tok.adminB = await tokenFor("admin@rsv2.dev", PW);
    tok.super = await tokenFor("super@rsv.dev", PW);
    tok.student = await tokenFor("stud@rsv.dev", PW);
  });

  it("requires auth + tenant + admin role on the management API", async () => {
    expect((await request(app).get("/api/v1/reservations")).status).toBe(401);
    expect((await request(app).get("/api/v1/reservations").set(auth(tok.super))).status).toBe(403);
    expect((await request(app).get("/api/v1/reservations").set(auth(tok.student))).status).toBe(403);
  });

  it("a student browses books, reserves, and an admin fulfils it", async () => {
    const books = await request(app).get("/api/v1/portal/library/books").set(auth(tok.student));
    expect(books.status).toBe(200);
    const wings = (books.body as { id: string; availableCopies: number }[]).find((b) => b.id === bookId);
    expect(wings?.availableCopies).toBe(1);

    const created = await request(app)
      .post(`/api/v1/portal/students/${s1}/reservations`)
      .set(auth(tok.student))
      .send({ bookId });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.bookTitle).toBe("Wings of Fire");
    const reservationId = created.body.id as string;

    // Duplicate pending reservation for the same book → 409.
    expect(
      (await request(app).post(`/api/v1/portal/students/${s1}/reservations`).set(auth(tok.student)).send({ bookId })).status
    ).toBe(409);

    // Admin sees it (pending) and fulfils it.
    const adminList = await request(app).get("/api/v1/reservations").set(auth(tok.admin));
    expect(adminList.body.meta.total).toBe(1);
    expect(adminList.body.data[0].studentName).toContain("Kavya");

    const fulfilled = await request(app)
      .patch(`/api/v1/reservations/${reservationId}`)
      .set(auth(tok.admin))
      .send({ status: "fulfilled" });
    expect(fulfilled.body.status).toBe("fulfilled");

    // Resolving again (no longer pending) → 404.
    expect(
      (await request(app).patch(`/api/v1/reservations/${reservationId}`).set(auth(tok.admin)).send({ status: "cancelled" })).status
    ).toBe(404);
  });

  it("a student cancels their own pending reservation", async () => {
    const created = await request(app)
      .post(`/api/v1/portal/students/${s1}/reservations`)
      .set(auth(tok.student))
      .send({ bookId: book2 });
    const id = created.body.id as string;

    expect(
      (await request(app).post(`/api/v1/portal/students/${s1}/reservations/${id}/cancel`).set(auth(tok.student))).status
    ).toBe(204);

    const mine = await request(app).get(`/api/v1/portal/students/${s1}/reservations`).set(auth(tok.student));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].status).toBe("cancelled");
  });

  it("isolates tenants — admin B sees none of admin A's reservations", async () => {
    await request(app).post(`/api/v1/portal/students/${s1}/reservations`).set(auth(tok.student)).send({ bookId });
    const adminB = await request(app).get("/api/v1/reservations").set(auth(tok.adminB));
    expect(adminB.body.meta.total).toBe(0);
  });
});
