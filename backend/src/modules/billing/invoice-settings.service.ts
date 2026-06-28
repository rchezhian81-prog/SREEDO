import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { invoiceSettingsSchema } from "./invoices.schema";

/**
 * Platform invoice settings — a single row (id = true) holding the supplier
 * profile, numbering rules, billing defaults, bank/UPI and PDF presentation.
 * Seeded by migration 0075, so getSettings() always returns a row.
 */

const SETTINGS_COLS = `
  prefix, fy_start_month AS "fyStartMonth", number_padding AS "numberPadding",
  next_invoice_number::int AS "nextInvoiceNumber",
  credit_note_prefix AS "creditNotePrefix", debit_note_prefix AS "debitNotePrefix",
  next_credit_note_number::int AS "nextCreditNoteNumber",
  next_debit_note_number::int AS "nextDebitNoteNumber",
  default_currency AS "defaultCurrency", default_tax_percent AS "defaultTaxPercent",
  default_sac AS "defaultSac", default_due_days AS "defaultDueDays",
  supplier_legal_name AS "supplierLegalName", supplier_trade_name AS "supplierTradeName",
  supplier_address AS "supplierAddress", supplier_gstin AS "supplierGstin",
  supplier_pan AS "supplierPan", supplier_state AS "supplierState",
  supplier_state_code AS "supplierStateCode", supplier_email AS "supplierEmail",
  supplier_phone AS "supplierPhone", bank_details AS "bankDetails", upi_id AS "upiId",
  pdf_footer AS "pdfFooter", pdf_terms AS "pdfTerms", signatory_name AS "signatoryName",
  logo_path AS "logoPath", updated_at AS "updatedAt"`;

export interface InvoiceSettings {
  prefix: string;
  fyStartMonth: number;
  numberPadding: number;
  nextInvoiceNumber: number;
  creditNotePrefix: string;
  debitNotePrefix: string;
  nextCreditNoteNumber: number;
  nextDebitNoteNumber: number;
  defaultCurrency: string;
  defaultTaxPercent: string;
  defaultSac: string | null;
  defaultDueDays: number | null;
  supplierLegalName: string | null;
  supplierTradeName: string | null;
  supplierAddress: string | null;
  supplierGstin: string | null;
  supplierPan: string | null;
  supplierState: string | null;
  supplierStateCode: string | null;
  supplierEmail: string | null;
  supplierPhone: string | null;
  bankDetails: string | null;
  upiId: string | null;
  pdfFooter: string | null;
  pdfTerms: string | null;
  signatoryName: string | null;
  logoPath: string | null;
  updatedAt: string;
}

export async function getSettings(): Promise<InvoiceSettings> {
  const { rows } = await query<InvoiceSettings>(
    `SELECT ${SETTINGS_COLS} FROM invoice_settings WHERE id = TRUE`
  );
  if (rows[0]) return rows[0];
  // Self-heal: the singleton can disappear if `users` is truncated (the FK
  // cascades) — re-seed it so settings are always available.
  await query(
    `INSERT INTO invoice_settings (id, supplier_legal_name)
     VALUES (TRUE, 'SRE EDU OS') ON CONFLICT (id) DO NOTHING`
  );
  const retry = await query<InvoiceSettings>(
    `SELECT ${SETTINGS_COLS} FROM invoice_settings WHERE id = TRUE`
  );
  return retry.rows[0];
}

const COLUMN_MAP: Record<string, string> = {
  prefix: "prefix",
  fyStartMonth: "fy_start_month",
  numberPadding: "number_padding",
  nextInvoiceNumber: "next_invoice_number",
  creditNotePrefix: "credit_note_prefix",
  debitNotePrefix: "debit_note_prefix",
  nextCreditNoteNumber: "next_credit_note_number",
  nextDebitNoteNumber: "next_debit_note_number",
  defaultCurrency: "default_currency",
  defaultTaxPercent: "default_tax_percent",
  defaultSac: "default_sac",
  defaultDueDays: "default_due_days",
  supplierLegalName: "supplier_legal_name",
  supplierTradeName: "supplier_trade_name",
  supplierAddress: "supplier_address",
  supplierGstin: "supplier_gstin",
  supplierPan: "supplier_pan",
  supplierState: "supplier_state",
  supplierStateCode: "supplier_state_code",
  supplierEmail: "supplier_email",
  supplierPhone: "supplier_phone",
  bankDetails: "bank_details",
  upiId: "upi_id",
  pdfFooter: "pdf_footer",
  pdfTerms: "pdf_terms",
  signatoryName: "signatory_name",
  logoPath: "logo_path",
};

/**
 * Reject setting a running counter below the highest already-issued number for
 * that series (no-op when the field is absent). `minSql` must SELECT one `min`
 * column = highest issued trailing number + 1.
 */
async function assertNextAtLeast(
  value: unknown,
  label: string,
  minSql: string
): Promise<void> {
  if (typeof value !== "number") return;
  const { rows } = await query<{ min: string }>(minSql);
  const min = Number(rows[0].min);
  if (value < min) {
    throw ApiError.badRequest(
      `${label} must be at least ${min} (above the highest already-issued number)`
    );
  }
}

export async function updateSettings(
  input: z.infer<typeof invoiceSettingsSchema>,
  actorId: string
): Promise<InvoiceSettings> {
  await getSettings(); // ensure the singleton row exists before updating
  const data = input as Record<string, unknown>;
  // Guard: a running counter can only be set at/above the highest already-issued
  // number, otherwise a future issue would collide with an existing document.
  // Applies identically to invoices and to each note series (credit / debit).
  await assertNextAtLeast(
    data.nextInvoiceNumber,
    "Next invoice number",
    `SELECT COALESCE(MAX((regexp_match(number, '(\\d+)$'))[1]::bigint), 0) + 1 AS min
     FROM saas_invoices WHERE number ~ '\\d+$'`
  );
  await assertNextAtLeast(
    data.nextCreditNoteNumber,
    "Next credit note number",
    `SELECT COALESCE(MAX((regexp_match(number, '(\\d+)$'))[1]::bigint), 0) + 1 AS min
     FROM saas_invoice_notes WHERE kind = 'credit' AND number ~ '\\d+$'`
  );
  await assertNextAtLeast(
    data.nextDebitNoteNumber,
    "Next debit note number",
    `SELECT COALESCE(MAX((regexp_match(number, '(\\d+)$'))[1]::bigint), 0) + 1 AS min
     FROM saas_invoice_notes WHERE kind = 'debit' AND number ~ '\\d+$'`
  );
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(COLUMN_MAP)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(actorId);
    sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
    await query(
      `UPDATE invoice_settings SET ${sets.join(", ")} WHERE id = TRUE`,
      params
    );
  }
  return getSettings();
}
