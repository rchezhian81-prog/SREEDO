import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { sendMail } from "../../utils/mailer";
import { invoicePdf, type InvoicePdfData } from "./invoices.pdf";
import type { z } from "zod";
import type {
  createInvoiceSchema,
  invoiceLineSchema,
  markPaidSchema,
} from "./invoices.schema";

/**
 * Gateway-free SaaS invoicing (Billing Phase B2).
 *
 * Draft → issue (assigns a financial-year-segmented number, freezes totals) →
 * mark-paid (OFFLINE) / void. No payment gateway and no auto-charging — markPaid
 * is a manual super-admin action. Amounts are NUMERIC(12,2) and all totals are
 * computed in SQL to avoid floating-point drift.
 */

// Columns are qualified with the `i` alias because listAll() joins institutions
// (which also has id/created_at) — unqualified names would be ambiguous. Every
// query using INVOICE_COLS aliases saas_invoices AS i.
const INVOICE_COLS = `
  i.id, i.institution_id AS "institutionId", i.package_id AS "packageId",
  i.number, i.status, i.currency,
  to_char(i.period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(i.period_end, 'YYYY-MM-DD') AS "periodEnd",
  i.subtotal, i.tax_percent AS "taxPercent", i.tax_amount AS "taxAmount", i.total,
  i.gstin, i.billing_name AS "billingName", i.billing_address AS "billingAddress",
  i.tax_notes AS "taxNotes", i.notes,
  i.issued_at AS "issuedAt", i.paid_at AS "paidAt",
  i.payment_method AS "paymentMethod", i.payment_reference AS "paymentReference",
  i.created_at AS "createdAt"`;

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
    `SELECT ${INVOICE_COLS} FROM saas_invoices i WHERE i.id = $1`,
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
    filter = ` AND i.status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT ${INVOICE_COLS} FROM saas_invoices i
     WHERE i.institution_id = $1${filter}
     ORDER BY i.created_at DESC`,
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

async function insertLine(
  exec: (text: string, params: unknown[]) => Promise<unknown>,
  invoiceId: string,
  line: InvoiceLine
): Promise<void> {
  await exec(
    `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, amount)
     VALUES ($1,$2,$3,$4, round($3::numeric * $4::numeric, 2))`,
    [invoiceId, line.description, line.quantity ?? 1, line.unitPrice ?? 0]
  );
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
         (institution_id, package_id, currency, period_start, period_end,
          tax_percent, gstin, billing_name, billing_address, tax_notes, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        institutionId,
        input.packageId ?? null,
        input.currency ?? env.saasInvoiceCurrency,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.taxPercent ?? 0,
        input.gstin ?? null,
        input.billingName ?? null,
        input.billingAddress ?? null,
        input.taxNotes ?? null,
        input.notes ?? null,
        createdBy,
      ]
    );
    const invoiceId = rows[0].id;
    for (const line of input.lines ?? []) {
      await insertLine((t, p) => client.query(t, p as never[]), invoiceId, line);
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
  await insertLine((t, p) => query(t, p as unknown[]), invoiceId, line);
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

/** Current financial year label (India FY: Apr–Mar), e.g. 'FY2026-27'. */
async function currentFyLabel(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: { label: string }[] }> }
): Promise<string> {
  const { rows } = await client.query(
    `SELECT 'FY' || fy_start || '-' || lpad(((fy_start + 1) % 100)::text, 2, '0') AS label
     FROM (
       SELECT CASE WHEN extract(month FROM CURRENT_DATE) >= 4
                   THEN extract(year FROM CURRENT_DATE)::int
                   ELSE extract(year FROM CURRENT_DATE)::int - 1 END AS fy_start
     ) s`
  );
  return rows[0].label;
}

/**
 * Issue a draft: assign the next FY-segmented number (immutable), freeze totals,
 * then best-effort email the institution's admins. Email failure NEVER fails the
 * issue (sendMail is fire-and-forget; the whole notify step is also guarded).
 */
export async function issueInvoice(invoiceId: string) {
  if ((await invoiceStatus(invoiceId)) !== "draft") {
    throw ApiError.badRequest("Only a draft invoice can be issued");
  }
  await recomputeTotals(invoiceId);
  await withTransaction(async (client) => {
    const label = await currentFyLabel(client as never);
    const ctr = await client.query<{ last_value: number }>(
      `INSERT INTO saas_invoice_counters (fy, last_value) VALUES ($1, 1)
       ON CONFLICT (fy) DO UPDATE SET last_value = saas_invoice_counters.last_value + 1
       RETURNING last_value`,
      [label]
    );
    const number = `${env.saasInvoicePrefix}${label}-${String(
      ctr.rows[0].last_value
    ).padStart(6, "0")}`;
    await client.query(
      `UPDATE saas_invoices SET status = 'issued', number = $2, issued_at = now()
       WHERE id = $1`,
      [invoiceId, number]
    );
  });
  await notifyInvoiceIssued(invoiceId);
  return getInvoice(invoiceId);
}

/** Best-effort "invoice issued" email to the institution's admins. Never throws. */
async function notifyInvoiceIssued(invoiceId: string): Promise<void> {
  try {
    const { rows } = await query<{
      number: string;
      currency: string;
      total: string;
      institution_id: string;
    }>(
      `SELECT number, currency, total::text AS total, institution_id
       FROM saas_invoices WHERE id = $1`,
      [invoiceId]
    );
    const inv = rows[0];
    if (!inv) return;
    const admins = await query<{ email: string }>(
      `SELECT email FROM users
       WHERE institution_id = $1 AND role = 'admin' AND is_active = true`,
      [inv.institution_id]
    );
    for (const a of admins.rows) {
      await sendMail({
        to: a.email,
        subject: `Invoice ${inv.number} from SRE EDU OS`,
        text:
          `A new subscription invoice (${inv.number}) for ${inv.currency} ${inv.total} ` +
          `has been issued to your institution. Please contact your SRE EDU OS ` +
          `administrator for the PDF and payment details.`,
      });
    }
  } catch (err) {
    console.error("invoice issued email failed (continuing):", err);
  }
}

/** Record OFFLINE payment (no gateway). */
export async function markPaid(invoiceId: string, input: MarkPaid) {
  if ((await invoiceStatus(invoiceId)) !== "issued") {
    throw ApiError.badRequest("Only an issued invoice can be marked paid");
  }
  await query(
    `UPDATE saas_invoices
       SET status = 'paid', payment_method = $2, payment_reference = $3,
           paid_at = COALESCE($4::timestamptz, now())
     WHERE id = $1`,
    [invoiceId, input.paymentMethod, input.reference ?? null, input.paidAt ?? null]
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

/** Render the invoice as a PDF (super-admin download). */
export async function invoicePdfBuffer(invoiceId: string): Promise<Buffer> {
  const { rows } = await query<InvoicePdfData & { institutionName: string }>(
    `SELECT i.number, i.status, i.currency,
            inst.name AS "institutionName",
            i.billing_name AS "billingName", i.billing_address AS "billingAddress",
            i.gstin,
            to_char(i.period_start, 'YYYY-MM-DD') AS "periodStart",
            to_char(i.period_end, 'YYYY-MM-DD') AS "periodEnd",
            i.issued_at::text AS "issuedAt", i.paid_at::text AS "paidAt",
            i.payment_method AS "paymentMethod",
            i.subtotal::text AS subtotal, i.tax_percent::text AS "taxPercent",
            i.tax_amount::text AS "taxAmount", i.total::text AS total,
            i.notes, i.tax_notes AS "taxNotes"
     FROM saas_invoices i
     JOIN institutions inst ON inst.id = i.institution_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  const lines = await query<InvoicePdfData["lines"][number]>(
    `SELECT description, quantity::text AS quantity,
            unit_price::text AS "unitPrice", amount::text AS amount
     FROM saas_invoice_lines WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  return invoicePdf({ ...rows[0], lines: lines.rows });
}
