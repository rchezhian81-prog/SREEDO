import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  listReservationsQuerySchema,
  updateReservationSchema,
  createReservationSchema,
} from "./reservations.schema";

const SELECT = `
  r.id,
  r.book_id AS "bookId",
  b.title AS "bookTitle",
  b.author AS "bookAuthor",
  r.student_id AS "studentId",
  (s.first_name || ' ' || s.last_name) AS "studentName",
  s.admission_no AS "admissionNo",
  r.status,
  r.notes,
  r.requested_at AS "requestedAt",
  r.resolved_at AS "resolvedAt"
FROM book_reservations r
JOIN books b ON b.id = r.book_id
JOIN students s ON s.id = r.student_id`;

// ------------------------------------------------------------------- admin side

export async function listReservations(
  pagination: Pagination,
  filters: z.infer<typeof listReservationsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["r.institution_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(b.title ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM book_reservations r
     JOIN books b ON b.id = r.book_id
     JOIN students s ON s.id = r.student_id ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY (r.status = 'pending') DESC, r.requested_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function updateReservationStatus(
  id: string,
  input: z.infer<typeof updateReservationSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `UPDATE book_reservations
     SET status = $1, resolved_at = now(), resolved_by = $2
     WHERE id = $3 AND institution_id = $4 AND status = 'pending'
     RETURNING id`,
    [input.status, userId, id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Pending reservation not found");
  const { rows: full } = await query(
    `SELECT ${SELECT} WHERE r.id = $1 AND r.institution_id = $2`,
    [id, institutionId]
  );
  return full[0];
}

// ----------------------------------------------------------------- portal side

export async function listAvailableBooks(institutionId: string, search?: string) {
  const params: unknown[] = [institutionId];
  let filter = "";
  if (search) {
    params.push(`%${search}%`);
    filter = `AND (b.title ILIKE $${params.length} OR b.author ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT b.id, b.title, b.author, b.isbn,
            (SELECT count(*)::int FROM book_copies bc
             WHERE bc.book_id = b.id AND bc.status = 'available') AS "availableCopies"
     FROM books b
     WHERE b.institution_id = $1 ${filter}
     ORDER BY b.title ASC
     LIMIT 200`,
    params
  );
  return rows;
}

export async function listStudentReservations(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE r.student_id = $1 AND r.institution_id = $2
     ORDER BY r.requested_at DESC`,
    [studentId, institutionId]
  );
  return rows;
}

export async function createStudentReservation(
  studentId: string,
  institutionId: string,
  input: z.infer<typeof createReservationSchema>
) {
  const book = await query<{ id: string }>(
    "SELECT id FROM books WHERE id = $1 AND institution_id = $2",
    [input.bookId, institutionId]
  );
  if (!book.rows[0]) throw ApiError.notFound("Book not found");

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO book_reservations (institution_id, book_id, student_id, notes)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [institutionId, input.bookId, studentId, input.notes ?? null]
    );
    const { rows: full } = await query(
      `SELECT ${SELECT} WHERE r.id = $1`,
      [rows[0].id]
    );
    return full[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.conflict("You already have a pending reservation for this book");
    }
    throw err;
  }
}

export async function cancelStudentReservation(
  id: string,
  studentId: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE book_reservations SET status = 'cancelled', resolved_at = now()
     WHERE id = $1 AND student_id = $2 AND institution_id = $3 AND status = 'pending'`,
    [id, studentId, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Pending reservation not found");
}
