import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { toPaise, toRupees } from "../../utils/money";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type { createRefundSchema, listRefundsQuerySchema } from "./feerefunds.schema";

const SELECT = `
  r.id,
  r.payment_id AS "paymentId",
  r.amount,
  r.reason,
  r.method,
  r.refunded_at AS "refundedAt",
  i.invoice_no AS "invoiceNo",
  (s.first_name || ' ' || s.last_name) AS "studentName",
  p.amount AS "paymentAmount"
FROM payment_refunds r
JOIN payments p ON p.id = r.payment_id
JOIN invoices i ON i.id = p.invoice_id
JOIN students s ON s.id = i.student_id`;

export async function listRefunds(
  pagination: Pagination,
  filters: z.infer<typeof listRefundsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["r.institution_id = $1"];
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(i.invoice_no ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM payment_refunds r
     JOIN payments p ON p.id = r.payment_id
     JOIN invoices i ON i.id = p.invoice_id
     JOIN students s ON s.id = i.student_id ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY r.refunded_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

/** Payments with their refundable balance, to choose from when refunding. */
export async function listRefundablePayments(institutionId: string, search?: string) {
  const params: unknown[] = [institutionId];
  let filter = "";
  if (search) {
    params.push(`%${search}%`);
    filter = `AND (i.invoice_no ILIKE $${params.length} OR s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT p.id, p.amount, p.method, p.paid_at AS "paidAt",
            i.invoice_no AS "invoiceNo",
            (s.first_name || ' ' || s.last_name) AS "studentName",
            COALESCE((SELECT sum(r.amount) FROM payment_refunds r WHERE r.payment_id = p.id), 0) AS "refunded",
            (p.amount - COALESCE((SELECT sum(r.amount) FROM payment_refunds r WHERE r.payment_id = p.id), 0)) AS "refundable"
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN students s ON s.id = i.student_id
     WHERE p.institution_id = $1 ${filter}
     ORDER BY p.paid_at DESC
     LIMIT 50`,
    params
  );
  return rows;
}

export async function getRefund(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE r.id = $1 AND r.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Refund not found");
  return rows[0];
}

export async function createRefund(
  input: z.infer<typeof createRefundSchema>,
  institutionId: string,
  userId: string
) {
  return withTransaction(async (client) => {
    // Lock the payment row and compute the already-refunded total atomically.
    const payment = await client.query<{ amount: string }>(
      "SELECT amount FROM payments WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [input.paymentId, institutionId]
    );
    if (!payment.rows[0]) throw ApiError.notFound("Payment not found");

    const refunded = await client.query<{ sum: string | null }>(
      "SELECT sum(amount) AS sum FROM payment_refunds WHERE payment_id = $1",
      [input.paymentId]
    );
    // Refundable balance computed in integer paise — exact, no epsilon needed.
    const remainingPaise =
      toPaise(payment.rows[0].amount) - toPaise(refunded.rows[0].sum ?? 0);
    if (toPaise(input.amount) > remainingPaise) {
      throw ApiError.badRequest(
        `Refund exceeds the refundable balance (${toRupees(remainingPaise).toFixed(2)})`
      );
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO payment_refunds (institution_id, payment_id, amount, reason, method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [institutionId, input.paymentId, input.amount, input.reason ?? null, input.method ?? "cash", userId]
    );
    return rows[0].id;
  }).then((id) => getRefund(id, institutionId));
}

export async function deleteRefund(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM payment_refunds WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Refund not found");
}
