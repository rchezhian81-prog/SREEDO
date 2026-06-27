import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createInvoiceSchema,
  invoiceLineSchema,
  markPaidSchema,
} from "./invoices.schema";

/**
 * Gateway-free SaaS invoicing (Billing Phase B2).
 *
 * The operator drafts an invoice for an institution, issues it (which assigns a
 * sequential number and freezes the line items), then records OFFLINE payment.
 * There is no payment gateway and no auto-charging — `markPaid` is a manual
 * super-admin action. All amounts are NUMERIC(12,2); totals are computed in SQL
 * to avoid floating-point drift.
 */

const INVOICE_COLS = `
  id, institution_id AS "institutionId", number, status, currency,
  to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(period_end, 'YYYY-MM-DD') AS "periodEnd",
  subtotal, tax_percent AS "taxPercent", tax_amount AS "taxAmount", total,
  notes, issued_at AS "issuedAt", paid_at AS "paidAt",
  payment_method AS "paymentMethod", created_at AS "createdAt"`;

const LINE_COLS = `
  id, invoice_id AS "invoiceId", description, quantity,
  unit_price AS "unitPrice", amount, created_at AS "createdAt"`;

type CreateInvoice = z.infer<typeof createInvoiceSchema>;
type InvoiceLine = z.infer<typeof invoiceLineSchema>;
type MarkPaid = z.infer<typeof markPaidSchema>;

async function assertInstitution(institutionId: string): Promise<void> {
  const { rows } = await query("SELECT 1 FROM institutions WHERE id = $1", [
    institutionId,
  ]);
  if (!rows[0]) throw ApiError.notFound("Institution not found");
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  const { rows } = await query<{ status: string }>(
    "SELECT status FROM saas_invoices WHERE id = $1",
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  return rows[0].status;
}

/** Recompute subtotal/tax/total from the invoice's lines (NUMERIC math in SQL). */
async function recomputeTotals(invoiceId: string): Promise<void> {
  await query(
    `UPDATE saas_invoices i SET
       subtotal = c.subtotal,
       tax_amount = round(c.subtotal * i.tax_percent / 100, 2),
       total = c.subtotal + round(c.subtotal * i.tax_percent / 100, 2)
     FROM (
       SELECT coalesce(sum(amount), 0)::numeric(12,2) AS subtotal
       FROM saas_invoice_lines WHERE invoice_id = $1
     ) c
     WHERE i.id = $1`,
    [invoiceId]
  );
}

export async function getInvoice(invoiceId: string) {
  const { rows } = await query(
    `SELECT ${INVOICE_COLS} FROM saas_invoices WHERE id = $1`,
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  const lines = await query(
    `SELECT ${LINE_COLS} FROM saas_invoice_lines WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  return { ...rows[0], lines: lines.rows };
}

export async function listForInstitution(
  institutionId: string,
  status?: string
) {
  const params: unknown[] = [institutionId];
  let filter = "";
  if (status) {
    params.push(status);
    filter = ` AND status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${INVOICE_COLS} FROM saas_invoices
     WHERE institution_id = $1${filter}
     ORDER BY created_at DESC`,
    params
  );
  return rows;
}

export async function listAll(status?: string) {
  const params: unknown[] = [];
  let filter = "";
  if (status) {
    params.push(status);
    filter = ` WHERE i.status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${INVOICE_COLS}, inst.name AS "institutionName", inst.code AS "institutionCode"
     FROM saas_invoices i
     JOIN institutions inst ON inst.id = i.institution_id
     ${filter}
     ORDER BY i.created_at DESC`,
    params
  );
  return rows;
}

export async function createDraft(
  institutionId: string,
  input: CreateInvoice,
  createdBy: string
) {
  await assertInstitution(institutionId);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO saas_invoices
         (institution_id, currency, period_start, period_end, tax_percent, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        institutionId,
        input.currency ?? env.saasInvoiceCurrency,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.taxPercent ?? 0,
        input.notes ?? null,
        createdBy,
      ]
    );
    const invoiceId = rows[0].id;
    for (const line of input.lines ?? []) {
      await client.query(
        `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4, round($3::numeric * $4::numeric, 2))`,
        [invoiceId, line.description, line.quantity ?? 1, line.unitPrice ?? 0]
      );
    }
    return invoiceId;
  });
  await recomputeTotals(id);
  return getInvoice(id);
}

export async function addLine(invoiceId: string, line: InvoiceLine) {
  if ((await invoiceStatus(invoiceId)) !== "draft") {
    throw ApiError.badRequest("Lines can only be added to a draft invoice");
  }
  await query(
    `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, amount)
     VALUES ($1,$2,$3,$4, round($3::numeric * $4::numeric, 2))`,
    [invoiceId, line.description, line.quantity ?? 1, line.unitPrice ?? 0]
  );
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

/** Issue a draft: assign the next sequential number and freeze it. */
export async function issueInvoice(invoiceId: string) {
  if ((await invoiceStatus(invoiceId)) !== "draft") {
    throw ApiError.badRequest("Only a draft invoice can be issued");
  }
  await recomputeTotals(invoiceId);
  const number = `${env.saasInvoicePrefix}${String(
    (await query<{ n: string }>("SELECT nextval('saas_invoice_seq')::text AS n"))
      .rows[0].n
  ).padStart(6, "0")}`;
  await query(
    `UPDATE saas_invoices
       SET status = 'issued', number = $2, issued_at = now()
     WHERE id = $1`,
    [invoiceId, number]
  );
  return getInvoice(invoiceId);
}

/** Record OFFLINE payment (no gateway). */
export async function markPaid(invoiceId: string, input: MarkPaid) {
  if ((await invoiceStatus(invoiceId)) !== "issued") {
    throw ApiError.badRequest("Only an issued invoice can be marked paid");
  }
  await query(
    `UPDATE saas_invoices
       SET status = 'paid', payment_method = $2,
           paid_at = COALESCE($3::timestamptz, now())
     WHERE id = $1`,
    [invoiceId, input.paymentMethod, input.paidAt ?? null]
  );
  return getInvoice(invoiceId);
}

export async function voidInvoice(invoiceId: string) {
  const status = await invoiceStatus(invoiceId);
  if (status === "paid") {
    throw ApiError.badRequest("A paid invoice cannot be voided");
  }
  if (status === "void") return getInvoice(invoiceId);
  await query("UPDATE saas_invoices SET status = 'void' WHERE id = $1", [
    invoiceId,
  ]);
  return getInvoice(invoiceId);
}
