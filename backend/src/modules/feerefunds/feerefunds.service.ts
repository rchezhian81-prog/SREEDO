import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { toPaise, toRupees } from "../../utils/money";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import { statusFor } from "../fees/feedepth.service";
import type { z } from "zod";
import type { createRefundSchema, listRefundsQuerySchema } from "./feerefunds.schema";

const SELECT = `
  r.id,
  r.payment_id AS "paymentId",
  r.amount,
  r.reason,
  r.method,
  r.refunded_at AS "refundedAt",
  r.voided_at AS "voidedAt",
  r.void_reason AS "voidReason",
  i.invoice_no AS "invoiceNo",
  (s.first_name || ' ' || s.last_name) AS "studentName",
  p.amount AS "paymentAmount"
FROM payment_refunds r
JOIN payments p ON p.id = r.payment_id
JOIN invoices i ON i.id = p.invoice_id
JOIN students s ON s.id = i.student_id`;

/** A single invoice's ledger change produced by reconciliation. */
export interface LedgerChange {
  invoiceId: string;
  invoiceNo: string;
  oldPaid: string;
  newPaid: string;
  oldStatus: string;
  newStatus: string;
  changed: boolean;
}

/**
 * Reconcile one invoice's ledger from the source-of-truth tables:
 *   amount_paid = sum(payments) − sum(NON-voided refunds), status via statusFor.
 * Idempotent — always recomputes from ledger, so re-running is a no-op. The
 * invoice row is locked FOR UPDATE by the caller's transaction.
 */
async function reconcileInvoice(
  client: PoolClient,
  invoiceId: string,
  institutionId: string
): Promise<LedgerChange | null> {
  const { rows } = await client.query<{
    invoice_no: string;
    amount_due: string;
    amount_paid: string;
    status: string;
  }>(
    `SELECT invoice_no, amount_due, amount_paid, status
     FROM invoices WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
    [invoiceId, institutionId]
  );
  const inv = rows[0];
  if (!inv) return null;

  const paid = await client.query<{ s: string }>(
    "SELECT COALESCE(sum(amount), 0) AS s FROM payments WHERE invoice_id = $1 AND institution_id = $2",
    [invoiceId, institutionId]
  );
  const refunded = await client.query<{ s: string }>(
    `SELECT COALESCE(sum(r.amount), 0) AS s
     FROM payment_refunds r JOIN payments p ON p.id = r.payment_id
     WHERE p.invoice_id = $1 AND r.institution_id = $2 AND r.voided_at IS NULL`,
    [invoiceId, institutionId]
  );

  // Net paid in integer paise; clamped at 0 (refunds can never exceed payments).
  const netPaise = Math.max(0, toPaise(paid.rows[0].s) - toPaise(refunded.rows[0].s));
  const newPaid = toRupees(netPaise).toFixed(2);
  const newStatus = statusFor(Number(inv.amount_due), toRupees(netPaise), inv.status);

  const changed =
    toPaise(inv.amount_paid) !== netPaise || inv.status !== newStatus;
  if (changed) {
    await client.query(
      "UPDATE invoices SET amount_paid = $1, status = $2 WHERE id = $3 AND institution_id = $4",
      [newPaid, newStatus, invoiceId, institutionId]
    );
  }
  return {
    invoiceId,
    invoiceNo: inv.invoice_no,
    oldPaid: Number(inv.amount_paid).toFixed(2),
    newPaid,
    oldStatus: inv.status,
    newStatus,
    changed,
  };
}

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

/** Payments with their refundable balance (voided refunds don't count). */
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
            COALESCE((SELECT sum(r.amount) FROM payment_refunds r
                      WHERE r.payment_id = p.id AND r.voided_at IS NULL), 0) AS "refunded",
            (p.amount - COALESCE((SELECT sum(r.amount) FROM payment_refunds r
                      WHERE r.payment_id = p.id AND r.voided_at IS NULL), 0)) AS "refundable"
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
  const id = await withTransaction(async (client) => {
    // Lock the payment row and compute the already-refunded (non-voided) total.
    const payment = await client.query<{ amount: string; invoice_id: string }>(
      "SELECT amount, invoice_id FROM payments WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [input.paymentId, institutionId]
    );
    if (!payment.rows[0]) throw ApiError.notFound("Payment not found");

    const refunded = await client.query<{ sum: string | null }>(
      "SELECT sum(amount) AS sum FROM payment_refunds WHERE payment_id = $1 AND voided_at IS NULL",
      [input.paymentId]
    );
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
      [institutionId, input.paymentId, input.amount, input.reason, input.method ?? "cash", userId]
    );
    // Reconcile the invoice ledger in the same transaction: net paid drops by the
    // refund, and the invoice status re-opens if it is no longer fully paid.
    await reconcileInvoice(client, payment.rows[0].invoice_id, institutionId);
    return rows[0].id;
  });
  return getRefund(id, institutionId);
}

/**
 * Void a refund (soft) — the historical row is preserved, the invoice ledger is
 * restored atomically. Replaces the old destructive hard-delete.
 */
export async function voidRefund(
  id: string,
  reason: string,
  institutionId: string,
  userId: string
) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ voided_at: string | null; invoice_id: string }>(
      `SELECT r.voided_at, p.invoice_id
       FROM payment_refunds r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1 AND r.institution_id = $2 FOR UPDATE OF r`,
      [id, institutionId]
    );
    const refund = rows[0];
    if (!refund) throw ApiError.notFound("Refund not found");
    if (refund.voided_at) throw ApiError.badRequest("Refund is already voided");

    await client.query(
      "UPDATE payment_refunds SET voided_at = now(), void_reason = $2, voided_by = $3 WHERE id = $1",
      [id, reason, userId]
    );
    await reconcileInvoice(client, refund.invoice_id, institutionId);
  });
  return getRefund(id, institutionId);
}

/**
 * One-time, idempotent, non-destructive backfill: recompute the ledger for every
 * invoice that has a refund. Re-running adjusts nothing (recompute-from-ledger).
 * Returns a report of every invoice whose amount_paid/status actually changed.
 */
export async function reconcileAll(
  institutionId: string
): Promise<{ scanned: number; adjusted: LedgerChange[] }> {
  const { rows: invoiceRows } = await query<{ invoice_id: string }>(
    `SELECT DISTINCT p.invoice_id
     FROM payment_refunds r JOIN payments p ON p.id = r.payment_id
     WHERE r.institution_id = $1`,
    [institutionId]
  );
  const adjusted: LedgerChange[] = [];
  for (const { invoice_id } of invoiceRows) {
    const change = await withTransaction((client) =>
      reconcileInvoice(client, invoice_id, institutionId)
    );
    if (change?.changed) adjusted.push(change);
  }
  return { scanned: invoiceRows.length, adjusted };
}
