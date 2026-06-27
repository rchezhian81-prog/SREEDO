import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createBookSchema,
  createCategorySchema,
  createCopySchema,
  createMemberSchema,
  issueSchema,
  postFineSchema,
  returnSchema,
  updateBookSchema,
  updateCategorySchema,
  updateCopySchema,
  updateMemberSchema,
  updateSettingsSchema,
} from "./library.schema";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

function genAccession(): string {
  return `ACC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function genInvoiceNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `LIB-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (input[field] !== undefined) {
      params.push(input[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

async function assertRef(
  table: "book_categories" | "books" | "students" | "teachers",
  id: string,
  institutionId: string,
  label: string
): Promise<void> {
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest(`Invalid ${label}`);
}

// --- Settings ---

interface Settings {
  loanDays: number;
  finePerDay: number;
  maxRenewals: number;
  maxBooksPerMember: number;
}

async function loadSettings(
  institutionId: string,
  client?: PoolClient
): Promise<Settings> {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT loan_days AS "loanDays", fine_per_day::float AS "finePerDay",
            max_renewals AS "maxRenewals", max_books_per_member AS "maxBooksPerMember"
     FROM library_settings WHERE institution_id = $1`,
    [institutionId]
  );
  return (
    (rows[0] as Settings | undefined) ?? {
      loanDays: 14,
      finePerDay: 1,
      maxRenewals: 2,
      maxBooksPerMember: 3,
    }
  );
}

export async function getSettings(institutionId: string) {
  return loadSettings(institutionId);
}

export async function updateSettings(
  input: z.infer<typeof updateSettingsSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO library_settings
       (institution_id, loan_days, fine_per_day, max_renewals, max_books_per_member)
     VALUES ($1, COALESCE($2, 14), COALESCE($3, 1), COALESCE($4, 2), COALESCE($5, 3))
     ON CONFLICT (institution_id) DO UPDATE SET
       loan_days = COALESCE($2, library_settings.loan_days),
       fine_per_day = COALESCE($3, library_settings.fine_per_day),
       max_renewals = COALESCE($4, library_settings.max_renewals),
       max_books_per_member = COALESCE($5, library_settings.max_books_per_member),
       updated_at = now()
     RETURNING loan_days AS "loanDays", fine_per_day::float AS "finePerDay",
               max_renewals AS "maxRenewals", max_books_per_member AS "maxBooksPerMember"`,
    [
      institutionId,
      input.loanDays ?? null,
      input.finePerDay ?? null,
      input.maxRenewals ?? null,
      input.maxBooksPerMember ?? null,
    ]
  );
  return rows[0];
}

// --- Categories ---

export async function listCategories(institutionId: string) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.code,
            (SELECT count(*)::int FROM books b WHERE b.category_id = c.id) AS "bookCount"
     FROM book_categories c WHERE c.institution_id = $1 ORDER BY c.name`,
    [institutionId]
  );
  return rows;
}

export async function createCategory(
  input: z.infer<typeof createCategorySchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO book_categories (institution_id, name, code)
       VALUES ($1, $2, $3) RETURNING id, name, code`,
      [institutionId, input.name, input.code ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A category with that name exists");
    throw err;
  }
}

export async function updateCategory(
  id: string,
  input: z.infer<typeof updateCategorySchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    { name: "name", code: "code" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE book_categories SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Category not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A category with that name exists");
    throw err;
  }
}

export async function deleteCategory(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM book_categories WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Category not found");
}

// --- Books ---

export async function listBooks(
  institutionId: string,
  filters: { categoryId?: string; search?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["b.institution_id = $1"];
  if (filters.categoryId) {
    params.push(filters.categoryId);
    where.push(`b.category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(b.title ILIKE $${params.length} OR b.author ILIKE $${params.length} OR b.isbn ILIKE $${params.length})`
    );
  }
  const { rows } = await query(
    `SELECT b.id, b.title, b.author, b.isbn, b.publisher, b.edition, b.subject,
            b.language, b.rack_location AS "rackLocation",
            b.category_id AS "categoryId", c.name AS "categoryName",
            count(cp.id)::int AS "totalCopies",
            count(cp.id) FILTER (WHERE cp.status = 'available')::int AS "availableCopies"
     FROM books b
     LEFT JOIN book_categories c ON c.id = b.category_id
     LEFT JOIN book_copies cp ON cp.book_id = b.id
     WHERE ${where.join(" AND ")}
     GROUP BY b.id, c.name
     ORDER BY b.title`,
    params
  );
  return rows;
}

export async function getBook(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT b.id, b.title, b.author, b.isbn, b.publisher, b.edition, b.subject,
            b.language, b.rack_location AS "rackLocation",
            b.category_id AS "categoryId", c.name AS "categoryName"
     FROM books b LEFT JOIN book_categories c ON c.id = b.category_id
     WHERE b.id = $1 AND b.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Book not found");
  const copies = await query(
    `SELECT id, accession_number AS "accessionNumber", barcode, status
     FROM book_copies WHERE book_id = $1 AND institution_id = $2
     ORDER BY accession_number`,
    [id, institutionId]
  );
  return { ...rows[0], copies: copies.rows };
}

export async function createBook(
  input: z.infer<typeof createBookSchema>,
  institutionId: string
) {
  if (input.categoryId)
    await assertRef("book_categories", input.categoryId, institutionId, "category");
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO books (institution_id, category_id, isbn, title, author, publisher,
                          edition, subject, language, rack_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, author, isbn, category_id AS "categoryId"`,
      [
        institutionId,
        input.categoryId ?? null,
        input.isbn ?? null,
        input.title,
        input.author ?? null,
        input.publisher ?? null,
        input.edition ?? null,
        input.subject ?? null,
        input.language ?? null,
        input.rackLocation ?? null,
      ]
    );
    const book = rows[0] as { id: string };
    const count = input.copyCount ?? 0;
    for (let i = 0; i < count; i++) {
      await client.query(
        `INSERT INTO book_copies (institution_id, book_id, accession_number)
         VALUES ($1, $2, $3)`,
        [institutionId, book.id, genAccession()]
      );
    }
    return { ...rows[0], copiesCreated: count };
  });
}

export async function updateBook(
  id: string,
  input: z.infer<typeof updateBookSchema>,
  institutionId: string
) {
  if (input.categoryId)
    await assertRef("book_categories", input.categoryId, institutionId, "category");
  const { sets, params } = buildSets(
    {
      categoryId: "category_id",
      isbn: "isbn",
      title: "title",
      author: "author",
      publisher: "publisher",
      edition: "edition",
      subject: "subject",
      language: "language",
      rackLocation: "rack_location",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE books SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, title, author, isbn, category_id AS "categoryId"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Book not found");
  return rows[0];
}

export async function deleteBook(id: string, institutionId: string) {
  const issued = await query(
    `SELECT 1 FROM book_copies WHERE book_id = $1 AND institution_id = $2 AND status = 'issued' LIMIT 1`,
    [id, institutionId]
  );
  if (issued.rows[0])
    throw ApiError.conflict("Cannot delete a book that has issued copies");
  const { rowCount } = await query(
    "DELETE FROM books WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Book not found");
}

// --- Copies ---

export async function listCopies(bookId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT id, accession_number AS "accessionNumber", barcode, status
     FROM book_copies WHERE book_id = $1 AND institution_id = $2
     ORDER BY accession_number`,
    [bookId, institutionId]
  );
  return rows;
}

export async function addCopy(
  bookId: string,
  input: z.infer<typeof createCopySchema>,
  institutionId: string
) {
  await assertRef("books", bookId, institutionId, "book");
  try {
    const { rows } = await query(
      `INSERT INTO book_copies (institution_id, book_id, accession_number, barcode)
       VALUES ($1, $2, $3, $4)
       RETURNING id, accession_number AS "accessionNumber", barcode, status`,
      [institutionId, bookId, input.accessionNumber ?? genAccession(), input.barcode ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That accession number already exists");
    throw err;
  }
}

export async function updateCopy(
  id: string,
  input: z.infer<typeof updateCopySchema>,
  institutionId: string
) {
  // A copy that is currently on loan can't be edited directly (return it first).
  if (input.status) {
    const current = await query<{ status: string }>(
      "SELECT status FROM book_copies WHERE id = $1 AND institution_id = $2",
      [id, institutionId]
    );
    if (!current.rows[0]) throw ApiError.notFound("Copy not found");
    if (current.rows[0].status === "issued" || input.status === "issued")
      throw ApiError.conflict("Issue/return changes a copy's loan status, not this endpoint");
  }
  const { sets, params } = buildSets(
    { accessionNumber: "accession_number", barcode: "barcode", status: "status" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE book_copies SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, accession_number AS "accessionNumber", barcode, status`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Copy not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That accession number already exists");
    throw err;
  }
}

export async function deleteCopy(id: string, institutionId: string) {
  const copy = await query<{ status: string }>(
    "SELECT status FROM book_copies WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!copy.rows[0]) throw ApiError.notFound("Copy not found");
  if (copy.rows[0].status === "issued")
    throw ApiError.conflict("Cannot delete an issued copy");
  await query("DELETE FROM book_copies WHERE id = $1 AND institution_id = $2", [
    id,
    institutionId,
  ]);
}

// --- Members ---

export async function listMembers(
  institutionId: string,
  filters: { memberType?: string; search?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["m.institution_id = $1"];
  if (filters.memberType) {
    params.push(filters.memberType);
    where.push(`m.member_type = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length}
        OR t.first_name ILIKE $${params.length} OR t.last_name ILIKE $${params.length}
        OR m.member_code ILIKE $${params.length})`
    );
  }
  const { rows } = await query(
    `SELECT m.id, m.member_type AS "memberType", m.member_code AS "memberCode", m.status,
            m.student_id AS "studentId", m.teacher_id AS "teacherId",
            COALESCE(s.first_name || ' ' || s.last_name, t.first_name || ' ' || t.last_name) AS name,
            COALESCE(s.admission_no, t.employee_no) AS "identifier",
            (SELECT count(*)::int FROM book_issues bi WHERE bi.member_id = m.id AND bi.status = 'issued') AS "openLoans"
     FROM library_members m
     LEFT JOIN students s ON s.id = m.student_id
     LEFT JOIN teachers t ON t.id = m.teacher_id
     WHERE ${where.join(" AND ")}
     ORDER BY name`,
    params
  );
  return rows;
}

export async function createMember(
  input: z.infer<typeof createMemberSchema>,
  institutionId: string
) {
  if (input.memberType === "student")
    await assertRef("students", input.studentId!, institutionId, "student");
  else await assertRef("teachers", input.teacherId!, institutionId, "teacher");
  try {
    const { rows } = await query(
      `INSERT INTO library_members (institution_id, member_type, student_id, teacher_id, member_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, member_type AS "memberType", student_id AS "studentId",
                 teacher_id AS "teacherId", member_code AS "memberCode", status`,
      [
        institutionId,
        input.memberType,
        input.studentId ?? null,
        input.teacherId ?? null,
        input.memberCode ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That person is already a member");
    throw err;
  }
}

export async function updateMember(
  id: string,
  input: z.infer<typeof updateMemberSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    { status: "status", memberCode: "member_code" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE library_members SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, member_type AS "memberType", member_code AS "memberCode", status`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Member not found");
  return rows[0];
}

export async function deleteMember(id: string, institutionId: string) {
  const open = await query(
    "SELECT 1 FROM book_issues WHERE member_id = $1 AND institution_id = $2 AND status = 'issued' LIMIT 1",
    [id, institutionId]
  );
  if (open.rows[0])
    throw ApiError.conflict("Cannot delete a member with books on loan");
  const { rowCount } = await query(
    "DELETE FROM library_members WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Member not found");
}

// --- Issue / renew / return ---

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function issueBook(
  input: z.infer<typeof issueSchema>,
  issuedBy: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const member = await client.query<{ status: string }>(
      "SELECT status FROM library_members WHERE id = $1 AND institution_id = $2",
      [input.memberId, institutionId]
    );
    if (!member.rows[0]) throw ApiError.badRequest("Invalid member");
    if (member.rows[0].status !== "active")
      throw ApiError.badRequest("Member is not active");

    const settings = await loadSettings(institutionId, client);
    const open = await client.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM book_issues WHERE member_id = $1 AND institution_id = $2 AND status = 'issued'",
      [input.memberId, institutionId]
    );
    if (Number(open.rows[0].count) >= settings.maxBooksPerMember)
      throw ApiError.conflict("Member has reached the borrowing limit");

    // Lock a free copy. By id when given, otherwise the first available copy.
    let copy: { id: string; book_id: string } | undefined;
    if (input.copyId) {
      const r = await client.query<{ id: string; book_id: string; status: string }>(
        "SELECT id, book_id, status FROM book_copies WHERE id = $1 AND institution_id = $2 FOR UPDATE",
        [input.copyId, institutionId]
      );
      if (!r.rows[0]) throw ApiError.badRequest("Invalid copy");
      if (r.rows[0].status !== "available")
        throw ApiError.conflict("That copy is not available");
      copy = r.rows[0];
    } else {
      const r = await client.query<{ id: string; book_id: string }>(
        `SELECT id, book_id FROM book_copies
         WHERE book_id = $1 AND institution_id = $2 AND status = 'available'
         ORDER BY accession_number FOR UPDATE SKIP LOCKED LIMIT 1`,
        [input.bookId, institutionId]
      );
      if (!r.rows[0]) throw ApiError.conflict("No copies available");
      copy = r.rows[0];
    }

    await client.query("UPDATE book_copies SET status = 'issued' WHERE id = $1", [
      copy.id,
    ]);
    const dueDate = input.dueDate ?? addDays(settings.loanDays);
    const { rows } = await client.query(
      `INSERT INTO book_issues (institution_id, copy_id, book_id, member_id, due_date, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, copy_id AS "copyId", book_id AS "bookId", member_id AS "memberId",
                 issue_date AS "issueDate", due_date AS "dueDate", status`,
      [institutionId, copy.id, copy.book_id, input.memberId, dueDate, issuedBy]
    );
    return rows[0];
  });
}

export async function renewIssue(id: string, institutionId: string) {
  const settings = await loadSettings(institutionId);
  const { rows } = await query(
    `UPDATE book_issues
     SET due_date = due_date + ($3::int), renewed_count = renewed_count + 1
     WHERE id = $1 AND institution_id = $2 AND status = 'issued'
       AND renewed_count < ($4::int)
     RETURNING id, due_date AS "dueDate", renewed_count AS "renewedCount"`,
    [id, institutionId, settings.loanDays, settings.maxRenewals]
  );
  if (!rows[0]) {
    // Distinguish "not found / not open" from "renewal cap reached".
    const exists = await query<{ renewed_count: number; status: string }>(
      "SELECT renewed_count, status FROM book_issues WHERE id = $1 AND institution_id = $2",
      [id, institutionId]
    );
    if (!exists.rows[0] || exists.rows[0].status !== "issued")
      throw ApiError.notFound("Open issue not found");
    throw ApiError.conflict("Renewal limit reached");
  }
  return rows[0];
}

export async function returnBook(
  id: string,
  input: z.infer<typeof returnSchema>,
  returnedBy: string,
  institutionId: string
) {
  const condition = input.condition ?? "ok";
  return withTransaction(async (client) => {
    const issue = await client.query<{ copy_id: string }>(
      "SELECT copy_id FROM book_issues WHERE id = $1 AND institution_id = $2 AND status = 'issued' FOR UPDATE",
      [id, institutionId]
    );
    if (!issue.rows[0]) throw ApiError.notFound("Open issue not found");

    const settings = await loadSettings(institutionId, client);
    const copyStatus =
      condition === "lost" ? "lost" : condition === "damaged" ? "damaged" : "available";
    const issueStatus = condition === "lost" ? "lost" : "returned";

    await client.query("UPDATE book_copies SET status = $2 WHERE id = $1", [
      issue.rows[0].copy_id,
      copyStatus,
    ]);
    const { rows } = await client.query(
      `UPDATE book_issues SET
         return_date = CURRENT_DATE,
         status = $3,
         returned_by = $4,
         fine_amount = GREATEST(0, CURRENT_DATE - due_date) * $5,
         fine_status = CASE WHEN GREATEST(0, CURRENT_DATE - due_date) * $5 > 0 THEN 'pending' ELSE 'none' END
       WHERE id = $1 AND institution_id = $2
       RETURNING id, status, return_date AS "returnDate",
                 fine_amount::float AS "fineAmount", fine_status AS "fineStatus"`,
      [id, institutionId, issueStatus, returnedBy, settings.finePerDay]
    );
    return rows[0];
  });
}

// --- Fines ---

export async function waiveFine(id: string, institutionId: string) {
  const { rows } = await query(
    `UPDATE book_issues SET fine_status = 'waived'
     WHERE id = $1 AND institution_id = $2 AND fine_status = 'pending'
     RETURNING id, fine_amount::float AS "fineAmount", fine_status AS "fineStatus"`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest("No pending fine to waive");
  return rows[0];
}

export async function postFineToInvoice(
  id: string,
  input: z.infer<typeof postFineSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const r = await client.query<{
      fine_amount: string;
      fine_status: string;
      member_type: string;
      student_id: string | null;
      title: string;
      accession_number: string;
    }>(
      `SELECT bi.fine_amount, bi.fine_status, m.member_type, m.student_id,
              b.title, cp.accession_number
       FROM book_issues bi
       JOIN library_members m ON m.id = bi.member_id
       JOIN books b ON b.id = bi.book_id
       JOIN book_copies cp ON cp.id = bi.copy_id
       WHERE bi.id = $1 AND bi.institution_id = $2 FOR UPDATE`,
      [id, institutionId]
    );
    const issue = r.rows[0];
    if (!issue) throw ApiError.notFound("Issue not found");
    if (issue.fine_status !== "pending")
      throw ApiError.badRequest("No pending fine to post");
    if (issue.member_type !== "student" || !issue.student_id)
      throw ApiError.badRequest("Fines can only be posted to student invoices");

    const dueDate = input.dueDate ?? addDays(14);
    const invoice = await client.query<{ id: string }>(
      `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        institutionId,
        genInvoiceNo(),
        issue.student_id,
        `Library fine — ${issue.title} (${issue.accession_number})`,
        issue.fine_amount,
        dueDate,
      ]
    );
    const { rows } = await client.query(
      `UPDATE book_issues SET fine_status = 'posted', invoice_id = $3
       WHERE id = $1 AND institution_id = $2
       RETURNING id, fine_amount::float AS "fineAmount", fine_status AS "fineStatus", invoice_id AS "invoiceId"`,
      [id, institutionId, invoice.rows[0].id]
    );
    return rows[0];
  });
}

// --- Member borrowing history ---

function historyQuery(extraWhere: string): string {
  return `SELECT bi.id, bi.book_id AS "bookId", b.title, cp.accession_number AS "accessionNumber",
            bi.issue_date AS "issueDate", bi.due_date AS "dueDate", bi.return_date AS "returnDate",
            bi.status, bi.renewed_count AS "renewedCount",
            bi.fine_amount::float AS "fineAmount", bi.fine_status AS "fineStatus",
            (bi.status = 'issued' AND bi.due_date < CURRENT_DATE) AS overdue
     FROM book_issues bi
     JOIN books b ON b.id = bi.book_id
     JOIN book_copies cp ON cp.id = bi.copy_id
     WHERE bi.institution_id = $1 AND ${extraWhere}
     ORDER BY bi.issue_date DESC, bi.created_at DESC`;
}

export async function memberHistory(memberId: string, institutionId: string) {
  const { rows } = await query(historyQuery("bi.member_id = $2"), [
    institutionId,
    memberId,
  ]);
  return rows;
}

/** Borrowing history for a student (used by the owner-scoped portal route). */
export async function historyForStudent(studentId: string, institutionId: string) {
  const member = await query<{ id: string }>(
    "SELECT id FROM library_members WHERE student_id = $1 AND institution_id = $2",
    [studentId, institutionId]
  );
  if (!member.rows[0]) return [];
  return memberHistory(member.rows[0].id, institutionId);
}
