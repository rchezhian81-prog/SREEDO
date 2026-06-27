import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createTransactionSchema,
  updateTransactionSchema,
  listTransactionsQuerySchema,
  summaryQuerySchema,
} from "./finance.schema";

const SELECT = `
  t.id,
  to_char(t.txn_date, 'YYYY-MM-DD') AS "txnDate",
  t.type,
  t.category,
  t.amount::float8 AS amount,
  t.description,
  t.payment_method AS "paymentMethod",
  t.reference_no AS "referenceNo",
  t.created_by AS "createdBy",
  t.created_at AS "createdAt"
FROM finance_transactions t`;

export async function listTransactions(
  pagination: Pagination,
  filters: z.infer<typeof listTransactionsQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["t.institution_id = $1"];
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`t.type = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`t.category = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`t.txn_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`t.txn_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM finance_transactions t ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${SELECT} ${where}
     ORDER BY t.txn_date DESC, t.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getTransaction(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SELECT} WHERE t.id = $1 AND t.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Transaction not found");
  return rows[0];
}

export async function createTransaction(
  input: z.infer<typeof createTransactionSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO finance_transactions (
       institution_id, txn_date, type, category, amount, description,
       payment_method, reference_no, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      institutionId,
      input.txnDate,
      input.type,
      input.category,
      input.amount,
      input.description ?? null,
      input.paymentMethod ?? null,
      input.referenceNo ?? null,
      userId,
    ]
  );
  return getTransaction(rows[0].id, institutionId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  txnDate: "txn_date",
  type: "type",
  category: "category",
  amount: "amount",
  description: "description",
  paymentMethod: "payment_method",
  referenceNo: "reference_no",
};

export async function updateTransaction(
  id: string,
  input: z.infer<typeof updateTransactionSchema>,
  institutionId: string
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(UPDATE_COLUMN_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id);
  params.push(institutionId);
  const { rowCount } = await query(
    `UPDATE finance_transactions SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Transaction not found");
  return getTransaction(id, institutionId);
}

export async function deleteTransaction(
  id: string,
  institutionId: string
): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM finance_transactions WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Transaction not found");
}

/** Totals (income / expense / net) and a per-category breakdown for a range. */
export async function summary(
  filters: z.infer<typeof summaryQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["institution_id = $1"];
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`txn_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`txn_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const totals = await query<{ income: number; expense: number }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)::float8 AS income,
       COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)::float8 AS expense
     FROM finance_transactions ${where}`,
    params
  );
  const byCategory = await query(
    `SELECT category, type, COALESCE(SUM(amount), 0)::float8 AS total
     FROM finance_transactions ${where}
     GROUP BY category, type
     ORDER BY total DESC`,
    params
  );
  const income = totals.rows[0].income;
  const expense = totals.rows[0].expense;
  return { income, expense, net: income - expense, byCategory: byCategory.rows };
}
