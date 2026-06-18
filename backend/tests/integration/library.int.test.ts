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

describe("library management", () => {
  let instA: string;
  let instB: string;
  let teacherRec: string;
  let st1: string; // linked to the student user
  let st2: string;
  const tok: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (p: string, t: string) => request(app).get(p).set(auth(t));
  const post = (p: string, t: string, b?: unknown) => request(app).post(p).set(auth(t)).send(b ?? {});
  const patch = (p: string, t: string, b: unknown) => request(app).patch(p).set(auth(t)).send(b);
  const del = (p: string, t: string) => request(app).delete(p).set(auth(t));

  // Create a book with N copies and return its id.
  async function makeBook(title: string, copyCount = 1): Promise<string> {
    const res = await post("/api/v1/library/books", tok.admin, { title, copyCount });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  async function makeStudentMember(studentId: string): Promise<string> {
    const res = await post("/api/v1/library/members", tok.admin, { memberType: "student", studentId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  beforeEach(async () => {
    await resetDb();
    instA = await createInstitution("LIB");

    await createUser({ email: "admin@lib.dev", password: PW, role: "admin", institutionId: instA });
    await createUser({ email: "teacher@lib.dev", password: PW, role: "teacher", institutionId: instA });
    await createUser({ email: "accountant@lib.dev", password: PW, role: "accountant", institutionId: instA });
    const studentUser = await createUser({ email: "student@lib.dev", password: PW, role: "student", institutionId: instA });
    const parentUser = await createUser({ email: "parent@lib.dev", password: PW, role: "parent", institutionId: instA });

    teacherRec = await insertId(
      `INSERT INTO teachers (institution_id, employee_no, first_name, last_name) VALUES ($1,'EMP-1','Ravi','S') RETURNING id`,
      [instA]
    );
    st1 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name, user_id) VALUES ($1,'LIB-1','Asha','K',$2) RETURNING id`,
      [instA, studentUser.id]
    );
    st2 = await insertId(
      `INSERT INTO students (institution_id, admission_no, first_name, last_name) VALUES ($1,'LIB-2','Bala','M') RETURNING id`,
      [instA]
    );
    await query(
      `INSERT INTO guardians (institution_id, user_id, student_id, relationship) VALUES ($1,$2,$3,'mother')`,
      [instA, parentUser.id, st1]
    );

    instB = await createInstitution("LIB2");
    await createUser({ email: "admin@lib2.dev", password: PW, role: "admin", institutionId: instB });

    for (const r of ["admin", "teacher", "accountant", "student", "parent"])
      tok[r] = await tokenFor(`${r}@lib.dev`, PW);
    tok.badmin = await tokenFor("admin@lib2.dev", PW);
  });

  it("manages the catalogue (category, book, copies)", async () => {
    const cat = await post("/api/v1/library/categories", tok.admin, { name: "Science", code: "SCI" });
    expect(cat.status).toBe(201);

    const book = await post("/api/v1/library/books", tok.admin, {
      title: "Physics Vol 1",
      author: "Resnick",
      isbn: "978-1",
      categoryId: cat.body.id,
      copyCount: 2,
    });
    expect(book.status).toBe(201);
    expect(book.body.copiesCreated).toBe(2);

    const list = await get("/api/v1/library/books", tok.admin);
    expect(list.status).toBe(200);
    const row = (list.body as Array<Record<string, unknown>>).find((b) => b.id === book.body.id)!;
    expect(row.totalCopies).toBe(2);
    expect(row.availableCopies).toBe(2);
    expect(row.categoryName).toBe("Science");

    // Add a third copy (auto accession), then a duplicate accession → 409.
    const c3 = await post(`/api/v1/library/books/${book.body.id}/copies`, tok.admin, { accessionNumber: "ACC-X" });
    expect(c3.status).toBe(201);
    expect((await post(`/api/v1/library/books/${book.body.id}/copies`, tok.admin, { accessionNumber: "ACC-X" })).status).toBe(409);

    const full = await get(`/api/v1/library/books/${book.body.id}`, tok.admin);
    expect(full.body.copies).toHaveLength(3);

    // Search + category filter.
    const search = await get("/api/v1/library/books?search=resnick", tok.admin);
    expect(search.body).toHaveLength(1);
  });

  it("issues, prevents over-issue, and returns", async () => {
    const book = await makeBook("Lone Copy", 1);
    const member = await makeStudentMember(st1);

    const issue = await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member });
    expect(issue.status).toBe(201);
    expect(issue.body.status).toBe("issued");

    // No more available copies for that book.
    expect((await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member })).status).toBe(409);
    const afterIssue = (await get("/api/v1/library/books", tok.admin)).body.find((b: { id: string }) => b.id === book);
    expect(afterIssue.availableCopies).toBe(0);

    // Return on time → no fine, copy available again.
    const ret = await post(`/api/v1/library/issues/${issue.body.id}/return`, tok.admin, {});
    expect(ret.status).toBe(200);
    expect(ret.body.status).toBe("returned");
    expect(ret.body.fineAmount).toBe(0);
    const afterReturn = (await get("/api/v1/library/books", tok.admin)).body.find((b: { id: string }) => b.id === book);
    expect(afterReturn.availableCopies).toBe(1);
  });

  it("enforces the borrowing limit", async () => {
    await patch("/api/v1/library/settings", tok.admin, { maxBooksPerMember: 1 });
    const member = await makeStudentMember(st1);
    const b1 = await makeBook("Book A", 1);
    const b2 = await makeBook("Book B", 1);
    expect((await post("/api/v1/library/issues", tok.admin, { bookId: b1, memberId: member })).status).toBe(201);
    expect((await post("/api/v1/library/issues", tok.admin, { bookId: b2, memberId: member })).status).toBe(409);
  });

  it("computes the overdue fine on return and posts/waives it", async () => {
    await patch("/api/v1/library/settings", tok.admin, { finePerDay: 2 });
    const member = await makeStudentMember(st1);
    const book = await makeBook("Overdue Book", 1);
    const issue = await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member });

    // Backdate the due date by 5 days → 5 * 2 = 10 fine on return.
    await query("UPDATE book_issues SET due_date = CURRENT_DATE - 5 WHERE id = $1", [issue.body.id]);
    const ret = await post(`/api/v1/library/issues/${issue.body.id}/return`, tok.admin, {});
    expect(ret.body.fineAmount).toBe(10);
    expect(ret.body.fineStatus).toBe("pending");

    // Accountant (library:fines) posts it to a student invoice.
    const posted = await post(`/api/v1/library/issues/${issue.body.id}/post-fine`, tok.accountant, {});
    expect(posted.status).toBe(200);
    expect(posted.body.fineStatus).toBe("posted");
    const inv = await query<{ amount_due: string; description: string }>(
      "SELECT amount_due, description FROM invoices WHERE id = $1",
      [posted.body.invoiceId]
    );
    expect(Number(inv.rows[0].amount_due)).toBe(10);
    expect(inv.rows[0].description).toContain("Library fine");

    // Posting again → no pending fine.
    expect((await post(`/api/v1/library/issues/${issue.body.id}/post-fine`, tok.accountant, {})).status).toBe(400);
  });

  it("renews an issue up to the limit", async () => {
    await patch("/api/v1/library/settings", tok.admin, { maxRenewals: 1 });
    const member = await makeStudentMember(st1);
    const book = await makeBook("Renewable", 1);
    const issue = await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member });

    const r1 = await post(`/api/v1/library/issues/${issue.body.id}/renew`, tok.admin, {});
    expect(r1.status).toBe(200);
    expect(r1.body.renewedCount).toBe(1);
    // Second renew exceeds the cap.
    expect((await post(`/api/v1/library/issues/${issue.body.id}/renew`, tok.admin, {})).status).toBe(409);
  });

  it("returns member borrowing history (staff) and owner-scoped student history", async () => {
    const member = await makeStudentMember(st1);
    const book = await makeBook("History Book", 1);
    const issue = await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member });
    await post(`/api/v1/library/issues/${issue.body.id}/return`, tok.admin, {});

    const hist = await get(`/api/v1/library/members/${member}/history`, tok.admin);
    expect(hist.status).toBe(200);
    expect(hist.body).toHaveLength(1);
    expect(hist.body[0].title).toBe("History Book");

    // Student sees their own history; not another student's.
    const own = await get(`/api/v1/library/students/${st1}/history`, tok.student);
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);
    expect((await get(`/api/v1/library/students/${st2}/history`, tok.student)).status).toBe(403);
    // Parent sees their linked child's history.
    expect((await get(`/api/v1/library/students/${st1}/history`, tok.parent)).status).toBe(200);
  });

  it("surfaces library reports in the Reports Center", async () => {
    const member = await makeStudentMember(st1);
    const book = await makeBook("Reported Book", 1);
    const issue = await post("/api/v1/library/issues", tok.admin, { bookId: book, memberId: member });
    await query("UPDATE book_issues SET due_date = CURRENT_DATE - 3 WHERE id = $1", [issue.body.id]);

    const stock = await get("/api/v1/report-center/library_stock", tok.admin);
    expect(stock.status).toBe(200);
    expect(stock.body.rows.find((r: { title: string }) => r.title === "Reported Book").issued).toBe(1);

    const overdue = await get("/api/v1/report-center/library_overdue", tok.admin);
    expect(overdue.body.rows).toHaveLength(1);
    expect(Number(overdue.body.rows[0].daysOverdue)).toBe(3);
  });

  it("enforces permission guards", async () => {
    const book = await makeBook("Guarded", 1);
    const member = await makeStudentMember(st1);

    // teacher: read yes, create/issue no.
    expect((await get("/api/v1/library/books", tok.teacher)).status).toBe(200);
    expect((await post("/api/v1/library/books", tok.teacher, { title: "X" })).status).toBe(403);
    expect((await post("/api/v1/library/issues", tok.teacher, { bookId: book, memberId: member })).status).toBe(403);

    // accountant: read yes, issue no, fines yes (waive a (non-)fine → 400 not 403).
    expect((await get("/api/v1/library/books", tok.accountant)).status).toBe(200);
    expect((await post("/api/v1/library/issues", tok.accountant, { bookId: book, memberId: member })).status).toBe(403);

    // student: no catalogue access at all.
    expect((await get("/api/v1/library/books", tok.student)).status).toBe(403);
    expect((await get("/api/v1/library/settings", tok.student)).status).toBe(403);
  });

  it("is tenant-scoped (no cross-institution access)", async () => {
    const book = await makeBook("A-only", 1);
    // B's admin cannot see or fetch A's book.
    expect((await get("/api/v1/library/books", tok.badmin)).body).toHaveLength(0);
    expect((await get(`/api/v1/library/books/${book}`, tok.badmin)).status).toBe(404);
    // B cannot make A's student a member (cross-tenant student → 400 invalid).
    expect((await post("/api/v1/library/members", tok.badmin, { memberType: "student", studentId: st1 })).status).toBe(400);
  });
});
