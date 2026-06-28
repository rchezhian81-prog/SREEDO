import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { getSettings } from "./invoice-settings.service";
import { currentFyLabel } from "./invoices.service";
import { notePdf, type NotePdfData } from "./notes.pdf";
import type { z } from "zod";
import type {
  createNoteSchema,
  noteLineSchema,
  updateNoteLineSchema,
  updateNoteSchema,
  noteListQuerySchema,
} from "./notes.schema";

/**
 * Credit & Debit notes (Billing P2).
 *
 * A note is a STANDALONE document linked to an ISSUED or PAID invoice — it never
 * modifies the original. Lifecycle mirrors invoices: draft → issue (continuous,
 * settable per-kind number; freeze totals; supplier snapshot) → void (reason
 * required). Flat tax only. Amounts are NUMERIC(12,2) computed in SQL. Money
 * actions are audited via platform_audit_log at the route layer
 * (target_type = 'saas_invoice_note').
 */

const NOTE_COLS = `
  n.id, n.invoice_id AS "invoiceId", n.institution_id AS "institutionId",
  n.kind, n.number, n.status, n.reason, n.currency,
  n.subtotal, n.tax_percent AS "taxPercent", n.tax_amount AS "taxAmount",
  n.round_off AS "roundOff", n.total,
  n.sac_code AS "sacCode", n.place_of_supply AS "placeOfSupply",
  n.reverse_charge AS "reverseCharge",
  n.supplier_state AS "supplierState", n.supplier_state_code AS "supplierStateCode",
  n.recipient_state AS "recipientState", n.recipient_state_code AS "recipientStateCode",
  n.notes,
  n.issued_at AS "issuedAt", n.void_reason AS "voidReason", n.voided_at AS "voidedAt",
  n.created_at AS "createdAt"`;

const LINE_COLS = `
  id, note_id AS "noteId", description, quantity,
  unit_price AS "unitPrice", sac_code AS "sacCode", amount, created_at AS "createdAt"`;

// Shape the route layer relies on (audit needs id/institutionId; UI uses the rest).
interface NoteRecord {
  id: string;
  invoiceId: string;
  institutionId: string;
  kind: "credit" | "debit";
  number: string | null;
  total: string;
  [key: string]: unknown;
}

type CreateNote = z.infer<typeof createNoteSchema>;
type NoteLine = z.infer<typeof noteLineSchema>;
type UpdateNoteLine = z.infer<typeof updateNoteLineSchema>;
type UpdateNote = z.infer<typeof updateNoteSchema>;
type NoteListQuery = z.infer<typeof noteListQuerySchema>;

/** The linked invoice's current state, or 404 if it doesn't exist. */
async function loadInvoiceForNote(invoiceId: string): Promise<{
  id: string;
  institutionId: string;
  status: string;
  currency: string;
  taxPercent: string;
  gstin: string | null;
  billingName: string | null;
  billingAddress: string | null;
  sacCode: string | null;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  recipientState: string | null;
  recipientStateCode: string | null;
}> {
  const { rows } = await query<{
    id: string;
    institutionId: string;
    status: string;
    currency: string;
    taxPercent: string;
    gstin: string | null;
    billingName: string | null;
    billingAddress: string | null;
    sacCode: string | null;
    placeOfSupply: string | null;
    reverseCharge: boolean;
    recipientState: string | null;
    recipientStateCode: string | null;
  }>(
    `SELECT id, institution_id AS "institutionId", status, currency,
            tax_percent AS "taxPercent", gstin,
            billing_name AS "billingName", billing_address AS "billingAddress",
            sac_code AS "sacCode", place_of_supply AS "placeOfSupply",
            reverse_charge AS "reverseCharge",
            recipient_state AS "recipientState", recipient_state_code AS "recipientStateCode"
     FROM saas_invoices WHERE id = $1`,
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  return rows[0];
}

async function noteStatus(noteId: string): Promise<{ status: string; kind: string }> {
  const { rows } = await query<{ status: string; kind: string }>(
    "SELECT status, kind FROM saas_invoice_notes WHERE id = $1",
    [noteId]
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  return rows[0];
}

async function assertNoteDraft(noteId: string, action: string): Promise<void> {
  if ((await noteStatus(noteId)).status !== "draft") {
    throw ApiError.badRequest(`Only a draft note can ${action}`);
  }
}

/** Recompute subtotal/tax/total from the note's lines (NUMERIC math in SQL). */
async function recomputeNoteTotals(noteId: string): Promise<void> {
  await query(
    `UPDATE saas_invoice_notes n SET
       subtotal = c.subtotal,
       tax_amount = round(c.subtotal * n.tax_percent / 100, 2),
       total = c.subtotal + round(c.subtotal * n.tax_percent / 100, 2) + n.round_off
     FROM (
       SELECT coalesce(sum(amount), 0)::numeric(12,2) AS subtotal
       FROM saas_invoice_note_lines WHERE note_id = $1
     ) c
     WHERE n.id = $1`,
    [noteId]
  );
}

export async function getNote(noteId: string) {
  const { rows } = await query<NoteRecord>(
    `SELECT ${NOTE_COLS} FROM saas_invoice_notes n WHERE n.id = $1`,
    [noteId]
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  const lines = await query(
    `SELECT ${LINE_COLS} FROM saas_invoice_note_lines WHERE note_id = $1 ORDER BY created_at`,
    [noteId]
  );
  // Lightweight summary of the linked invoice (for the note detail header).
  const inv = await query(
    `SELECT i.id, i.number, i.status,
            inst.name AS "institutionName", inst.code AS "institutionCode"
     FROM saas_invoices i JOIN institutions inst ON inst.id = i.institution_id
     WHERE i.id = $1`,
    [rows[0].invoiceId]
  );
  return { ...rows[0], lines: lines.rows, invoice: inv.rows[0] ?? null };
}

/** Note money-action audit timeline (reads the shared platform_audit_log). */
export async function getNoteAudit(noteId: string) {
  const { rows } = await query(
    `SELECT action, actor_email AS "actorEmail", actor_role AS "actorRole",
            detail, ip, created_at AS "createdAt"
     FROM platform_audit_log
     WHERE target_type = 'saas_invoice_note' AND target_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [noteId]
  );
  return rows;
}

/** Notes attached to one invoice (optionally filtered by kind/status). */
export async function listForInvoice(invoiceId: string, q: NoteListQuery = {}) {
  const params: unknown[] = [invoiceId];
  const where: string[] = ["n.invoice_id = $1"];
  if (q.kind) {
    params.push(q.kind);
    where.push(`n.kind = $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`n.status = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT ${NOTE_COLS} FROM saas_invoice_notes n
     WHERE ${where.join(" AND ")}
     ORDER BY n.created_at DESC`,
    params
  );
  return rows;
}

async function insertLine(
  exec: (text: string, params: unknown[]) => Promise<unknown>,
  noteId: string,
  line: NoteLine
): Promise<void> {
  await exec(
    `INSERT INTO saas_invoice_note_lines (note_id, description, quantity, unit_price, sac_code, amount)
     VALUES ($1,$2,$3,$4,$5, round($3::numeric * $4::numeric, 2))`,
    [noteId, line.description, line.quantity ?? 1, line.unitPrice ?? 0, line.sacCode ?? null]
  );
}

/**
 * Create a draft note against an invoice. The invoice must already be ISSUED or
 * PAID (a note adjusts a real document, never a draft or void one). GST/billing
 * defaults are copied from the invoice unless overridden in the input.
 */
export async function createNote(
  invoiceId: string,
  input: CreateNote,
  createdBy: string
) {
  const invoice = await loadInvoiceForNote(invoiceId);
  if (invoice.status !== "issued" && invoice.status !== "paid") {
    throw ApiError.badRequest(
      "A credit/debit note can only be created against an issued or paid invoice"
    );
  }
  const settings = await getSettings();
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO saas_invoice_notes
         (invoice_id, institution_id, kind, currency, tax_percent, reason, notes,
          sac_code, place_of_supply, reverse_charge, recipient_state,
          recipient_state_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        invoiceId,
        invoice.institutionId,
        input.kind,
        input.currency ?? invoice.currency ?? settings.defaultCurrency,
        input.taxPercent ?? Number(invoice.taxPercent) ?? 0,
        input.reason ?? null,
        input.notes ?? null,
        input.sacCode ?? invoice.sacCode ?? settings.defaultSac ?? null,
        input.placeOfSupply ?? invoice.placeOfSupply ?? null,
        input.reverseCharge ?? invoice.reverseCharge ?? false,
        input.recipientState ?? invoice.recipientState ?? null,
        input.recipientStateCode ?? invoice.recipientStateCode ?? null,
        createdBy,
      ]
    );
    const noteId = rows[0].id;
    for (const line of input.lines ?? []) {
      await insertLine((t, p) => client.query(t, p as never[]), noteId, line);
    }
    return noteId;
  });
  await recomputeNoteTotals(id);
  return getNote(id);
}

export async function addNoteLine(noteId: string, line: NoteLine) {
  await assertNoteDraft(noteId, "have lines added");
  await insertLine((t, p) => query(t, p as unknown[]), noteId, line);
  await recomputeNoteTotals(noteId);
  return getNote(noteId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  reason: "reason",
  currency: "currency",
  taxPercent: "tax_percent",
  notes: "notes",
  sacCode: "sac_code",
  placeOfSupply: "place_of_supply",
  reverseCharge: "reverse_charge",
  recipientState: "recipient_state",
  recipientStateCode: "recipient_state_code",
};

export async function updateNote(noteId: string, input: UpdateNote) {
  await assertNoteDraft(noteId, "be edited");
  const data = input as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(UPDATE_COLUMN_MAP)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(noteId);
    await query(
      `UPDATE saas_invoice_notes SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
  }
  await recomputeNoteTotals(noteId);
  return getNote(noteId);
}

export async function updateNoteLine(
  noteId: string,
  lineId: string,
  input: UpdateNoteLine
) {
  await assertNoteDraft(noteId, "have lines edited");
  const data = input as Record<string, unknown>;
  const colMap: Record<string, string> = {
    description: "description",
    quantity: "quantity",
    unitPrice: "unit_price",
    sacCode: "sac_code",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(colMap)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(lineId, noteId);
    const { rowCount } = await query(
      `UPDATE saas_invoice_note_lines SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND note_id = $${params.length}`,
      params
    );
    if (!rowCount) throw ApiError.notFound("Line not found");
  }
  await query(
    `UPDATE saas_invoice_note_lines SET amount = round(quantity * unit_price, 2)
     WHERE id = $1 AND note_id = $2`,
    [lineId, noteId]
  );
  await recomputeNoteTotals(noteId);
  return getNote(noteId);
}

export async function removeNoteLine(noteId: string, lineId: string) {
  await assertNoteDraft(noteId, "have lines removed");
  const { rowCount } = await query(
    "DELETE FROM saas_invoice_note_lines WHERE id = $1 AND note_id = $2",
    [lineId, noteId]
  );
  if (!rowCount) throw ApiError.notFound("Line not found");
  await recomputeNoteTotals(noteId);
  return getNote(noteId);
}

export async function deleteNote(noteId: string) {
  await assertNoteDraft(noteId, "be deleted");
  await query("DELETE FROM saas_invoice_notes WHERE id = $1", [noteId]);
  return { id: noteId, deleted: true };
}

/**
 * Issue a draft note: assign the next number from the per-kind continuous,
 * settable counter (credit / debit each their own series, sharing the invoice
 * FY label + padding), freeze totals, snapshot the supplier state, record the
 * issuer. The number is immutable thereafter.
 */
export async function issueNote(noteId: string, issuedBy?: string) {
  const { kind } = await noteStatus(noteId);
  await assertNoteDraft(noteId, "be issued");
  await recomputeNoteTotals(noteId);
  const settings = await getSettings();
  const padding = settings.numberPadding || 6;
  const fyStartMonth = settings.fyStartMonth || 4;
  // Column + prefix are chosen from the validated `kind` enum (never user input),
  // so the dynamic column name in the UPDATE is safe.
  const counterCol =
    kind === "credit" ? "next_credit_note_number" : "next_debit_note_number";
  const prefix =
    kind === "credit" ? settings.creditNotePrefix : settings.debitNotePrefix;
  await withTransaction(async (client) => {
    const label = await currentFyLabel(client as never, fyStartMonth);
    const seq = await client.query<{ assigned: string }>(
      `UPDATE invoice_settings SET ${counterCol} = ${counterCol} + 1
       WHERE id = TRUE RETURNING (${counterCol} - 1)::text AS assigned`
    );
    const number = `${prefix}${label}-${String(seq.rows[0].assigned).padStart(
      padding,
      "0"
    )}`;
    await client.query(
      `UPDATE saas_invoice_notes SET
         status = 'issued', number = $2, issued_at = now(), issued_by = $3,
         supplier_state = $4, supplier_state_code = $5
       WHERE id = $1`,
      [
        noteId,
        number,
        issuedBy ?? null,
        settings.supplierState ?? null,
        settings.supplierStateCode ?? null,
      ]
    );
  });
  return getNote(noteId);
}

/** Void a draft or issued note with a required reason. */
export async function voidNote(noteId: string, reason: string, voidedBy?: string) {
  const { status } = await noteStatus(noteId);
  if (status === "void") return getNote(noteId);
  await query(
    `UPDATE saas_invoice_notes
       SET status = 'void', void_reason = $2, voided_by = $3, voided_at = now()
     WHERE id = $1`,
    [noteId, reason, voidedBy ?? null]
  );
  return getNote(noteId);
}

/** Render the note as a PDF (super-admin download). */
export async function notePdfBuffer(noteId: string): Promise<Buffer> {
  const settings = await getSettings();
  const { rows } = await query<NotePdfData & { institutionName: string }>(
    `SELECT n.kind, n.number, n.status, n.currency, n.reason,
            inst.name AS "institutionName",
            i.number AS "againstInvoiceNumber",
            i.billing_name AS "billingName", i.billing_address AS "billingAddress",
            i.gstin,
            n.issued_at::text AS "issuedAt",
            n.subtotal::text AS subtotal, n.tax_percent::text AS "taxPercent",
            n.tax_amount::text AS "taxAmount", n.round_off::text AS "roundOff",
            n.total::text AS total,
            n.sac_code AS "sacCode", n.place_of_supply AS "placeOfSupply",
            n.reverse_charge AS "reverseCharge",
            n.recipient_state AS "recipientState", n.recipient_state_code AS "recipientStateCode",
            n.notes
     FROM saas_invoice_notes n
     JOIN saas_invoices i ON i.id = n.invoice_id
     JOIN institutions inst ON inst.id = n.institution_id
     WHERE n.id = $1`,
    [noteId]
  );
  if (!rows[0]) throw ApiError.notFound("Note not found");
  const lines = await query<NotePdfData["lines"][number]>(
    `SELECT description, quantity::text AS quantity,
            unit_price::text AS "unitPrice", sac_code AS "sacCode", amount::text AS amount
     FROM saas_invoice_note_lines WHERE note_id = $1 ORDER BY created_at`,
    [noteId]
  );
  return notePdf({
    ...rows[0],
    lines: lines.rows,
    company: {
      name: settings.supplierLegalName || env.saasCompanyName,
      tradeName: settings.supplierTradeName,
      address: settings.supplierAddress || env.saasCompanyAddress,
      email: settings.supplierEmail || env.saasCompanyEmail,
      phone: settings.supplierPhone,
      gstin: settings.supplierGstin || env.saasCompanyGstin,
      pan: settings.supplierPan,
      state: settings.supplierState,
      stateCode: settings.supplierStateCode,
      bankDetails: settings.bankDetails,
      upiId: settings.upiId,
      signatoryName: settings.signatoryName,
      footer: settings.pdfFooter,
      terms: settings.pdfTerms,
      logoPath: settings.logoPath || env.saasCompanyLogoPath,
    },
  });
}
