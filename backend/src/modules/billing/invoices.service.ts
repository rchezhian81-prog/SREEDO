import { query, withTransaction } from "../../db/postgres";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { sendMail, mailerConfigured } from "../../utils/mailer";
import { getSettings } from "./invoice-settings.service";
import { invoicePdf, type InvoicePdfData } from "./invoices.pdf";
import type { z } from "zod";
import type {
  createInvoiceSchema,
  invoiceLineSchema,
  updateLineSchema,
  listInvoicesQuerySchema,
  markPaidSchema,
  updateInvoiceSchema,
} from "./invoices.schema";

/**
 * Gateway-free SaaS invoicing (Billing Phase B2 / B2.2 / P0).
 *
 * Draft → issue (FY number, freeze totals, due date, supplier snapshot) →
 * mark-paid (OFFLINE, single full payment) / void (reason required). No payment
 * gateway and no auto-charging. Amounts are NUMERIC(12,2) computed in SQL.
 * "Overdue" is computed at read time. Settings (supplier profile, numbering,
 * defaults) come from the singleton invoice_settings row. Money actions are
 * audited via platform_audit_log at the route layer.
 */

const INVOICE_COLS = `
  i.id, i.institution_id AS "institutionId", i.package_id AS "packageId",
  i.number, i.status, i.currency,
  to_char(i.period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(i.period_end, 'YYYY-MM-DD') AS "periodEnd",
  i.payment_terms_days AS "paymentTermsDays",
  to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
  (i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS "isOverdue",
  i.subtotal, i.tax_percent AS "taxPercent", i.tax_amount AS "taxAmount",
  i.round_off AS "roundOff", i.total,
  i.gstin, i.billing_name AS "billingName", i.billing_address AS "billingAddress",
  i.tax_notes AS "taxNotes", i.notes,
  i.sac_code AS "sacCode", i.place_of_supply AS "placeOfSupply",
  i.reverse_charge AS "reverseCharge",
  i.supplier_state AS "supplierState", i.supplier_state_code AS "supplierStateCode",
  i.recipient_state AS "recipientState", i.recipient_state_code AS "recipientStateCode",
  i.issued_at AS "issuedAt", i.paid_at AS "paidAt",
  i.payment_method AS "paymentMethod", i.payment_reference AS "paymentReference",
  i.void_reason AS "voidReason", i.voided_at AS "voidedAt",
  i.created_at AS "createdAt"`;

const LINE_COLS = `
  id, invoice_id AS "invoiceId", description, quantity,
  unit_price AS "unitPrice", sac_code AS "sacCode", amount, created_at AS "createdAt"`;

const EMAIL_COLS = `
  id, recipient, template, status, error,
  triggered_by AS "triggeredBy", created_at AS "createdAt"`;

// Shape the route layer relies on (audit needs id/institutionId; UI uses the rest).
interface InvoiceRecord {
  id: string;
  institutionId: string;
  number: string | null;
  total: string;
  [key: string]: unknown;
}

type CreateInvoice = z.infer<typeof createInvoiceSchema>;
type InvoiceLine = z.infer<typeof invoiceLineSchema>;
type UpdateLine = z.infer<typeof updateLineSchema>;
type ListQuery = z.infer<typeof listInvoicesQuerySchema>;
type MarkPaid = z.infer<typeof markPaidSchema>;
type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;

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

async function assertDraft(invoiceId: string, action: string): Promise<void> {
  if ((await invoiceStatus(invoiceId)) !== "draft") {
    throw ApiError.badRequest(`Only a draft invoice can ${action}`);
  }
}

/** Recompute subtotal/tax/total from the invoice's lines (NUMERIC math in SQL). */
async function recomputeTotals(invoiceId: string): Promise<void> {
  await query(
    `UPDATE saas_invoices i SET
       subtotal = c.subtotal,
       tax_amount = round(c.subtotal * i.tax_percent / 100, 2),
       total = c.subtotal + round(c.subtotal * i.tax_percent / 100, 2) + i.round_off
     FROM (
       SELECT coalesce(sum(amount), 0)::numeric(12,2) AS subtotal
       FROM saas_invoice_lines WHERE invoice_id = $1
     ) c
     WHERE i.id = $1`,
    [invoiceId]
  );
}

export async function getInvoice(invoiceId: string) {
  const { rows } = await query<InvoiceRecord>(
    `SELECT ${INVOICE_COLS} FROM saas_invoices i WHERE i.id = $1`,
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  const lines = await query(
    `SELECT ${LINE_COLS} FROM saas_invoice_lines WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  const emails = await query(
    `SELECT ${EMAIL_COLS} FROM invoice_emails WHERE invoice_id = $1 ORDER BY created_at DESC`,
    [invoiceId]
  );
  return { ...rows[0], lines: lines.rows, emails: emails.rows };
}

/** Invoice money-action audit timeline (reads the shared platform_audit_log). */
export async function getAudit(invoiceId: string) {
  const { rows } = await query(
    `SELECT action, actor_email AS "actorEmail", actor_role AS "actorRole",
            detail, ip, created_at AS "createdAt"
     FROM platform_audit_log
     WHERE target_type = 'saas_invoice' AND target_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [invoiceId]
  );
  return rows;
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

const SORT_COLUMNS: Record<string, string> = {
  createdAt: "i.created_at",
  dueDate: "i.due_date",
  total: "i.total",
  number: "i.number",
  status: "i.status",
};

export async function listAll(q: ListQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.status) add((n) => `i.status = $${n}`, q.status);
  if (q.institutionId) add((n) => `i.institution_id = $${n}`, q.institutionId);
  if (q.overdue) {
    where.push(
      `(i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE)`
    );
  }
  if (q.from) add((n) => `i.created_at >= $${n}::date`, q.from);
  if (q.to) add((n) => `i.created_at < ($${n}::date + 1)`, q.to);
  if (q.q) {
    add(
      (n) =>
        `(i.number ILIKE $${n} OR inst.name ILIKE $${n} OR inst.code ILIKE $${n} OR i.gstin ILIKE $${n} OR i.payment_reference ILIKE $${n})`,
      `%${q.q}%`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const count = await query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM saas_invoices i JOIN institutions inst ON inst.id = i.institution_id
     ${whereSql}`,
    params
  );

  const sortCol = SORT_COLUMNS[q.sort] ?? "i.created_at";
  const order = q.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${INVOICE_COLS}, inst.name AS "institutionName", inst.code AS "institutionCode"
     FROM saas_invoices i JOIN institutions inst ON inst.id = i.institution_id
     ${whereSql}
     ORDER BY ${sortCol} ${order} NULLS LAST, i.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
}

export async function summary() {
  const overdue =
    "status = 'issued' AND due_date IS NOT NULL AND due_date < CURRENT_DATE";
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE status = 'draft')::int  AS "draftCount",
       count(*) FILTER (WHERE status = 'issued')::int AS "issuedCount",
       count(*) FILTER (WHERE status = 'paid')::int   AS "paidCount",
       count(*) FILTER (WHERE status = 'void')::int   AS "voidCount",
       coalesce(sum(total) FILTER (WHERE status = 'issued'), 0)::text AS "outstandingAmount",
       coalesce(sum(total) FILTER (WHERE status = 'paid'), 0)::text   AS "paidAmount",
       count(*) FILTER (WHERE ${overdue})::int AS "overdueCount",
       coalesce(sum(total) FILTER (WHERE ${overdue}), 0)::text AS "overdueAmount"
     FROM saas_invoices`
  );
  return rows[0];
}

async function insertLine(
  exec: (text: string, params: unknown[]) => Promise<unknown>,
  invoiceId: string,
  line: InvoiceLine
): Promise<void> {
  await exec(
    `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, sac_code, amount)
     VALUES ($1,$2,$3,$4,$5, round($3::numeric * $4::numeric, 2))`,
    [invoiceId, line.description, line.quantity ?? 1, line.unitPrice ?? 0, line.sacCode ?? null]
  );
}

export async function createDraft(
  institutionId: string,
  input: CreateInvoice,
  createdBy: string
) {
  await assertInstitution(institutionId);
  const settings = await getSettings();
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO saas_invoices
         (institution_id, package_id, currency, period_start, period_end,
          payment_terms_days, due_date, tax_percent, gstin, billing_name,
          billing_address, tax_notes, notes, sac_code, place_of_supply,
          reverse_charge, recipient_state, recipient_state_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [
        institutionId,
        input.packageId ?? null,
        input.currency ?? settings.defaultCurrency ?? env.saasInvoiceCurrency,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.paymentTermsDays ?? settings.defaultDueDays ?? null,
        input.dueDate ?? null,
        input.taxPercent ?? Number(settings.defaultTaxPercent) ?? 0,
        input.gstin ?? null,
        input.billingName ?? null,
        input.billingAddress ?? null,
        input.taxNotes ?? null,
        input.notes ?? null,
        input.sacCode ?? settings.defaultSac ?? null,
        input.placeOfSupply ?? null,
        input.reverseCharge ?? false,
        input.recipientState ?? null,
        input.recipientStateCode ?? null,
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
  await assertDraft(invoiceId, "have lines added");
  await insertLine((t, p) => query(t, p as unknown[]), invoiceId, line);
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

const UPDATE_COLUMN_MAP: Record<string, string> = {
  packageId: "package_id",
  currency: "currency",
  periodStart: "period_start",
  periodEnd: "period_end",
  paymentTermsDays: "payment_terms_days",
  dueDate: "due_date",
  taxPercent: "tax_percent",
  gstin: "gstin",
  billingName: "billing_name",
  billingAddress: "billing_address",
  taxNotes: "tax_notes",
  notes: "notes",
  sacCode: "sac_code",
  placeOfSupply: "place_of_supply",
  reverseCharge: "reverse_charge",
  recipientState: "recipient_state",
  recipientStateCode: "recipient_state_code",
};

export async function updateDraft(invoiceId: string, input: UpdateInvoice) {
  await assertDraft(invoiceId, "be edited");
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
    params.push(invoiceId);
    await query(
      `UPDATE saas_invoices SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
  }
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

export async function updateLine(
  invoiceId: string,
  lineId: string,
  input: UpdateLine
) {
  await assertDraft(invoiceId, "have lines edited");
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
    params.push(lineId, invoiceId);
    const { rowCount } = await query(
      `UPDATE saas_invoice_lines SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND invoice_id = $${params.length}`,
      params
    );
    if (!rowCount) throw ApiError.notFound("Line not found");
  }
  await query(
    `UPDATE saas_invoice_lines SET amount = round(quantity * unit_price, 2)
     WHERE id = $1 AND invoice_id = $2`,
    [lineId, invoiceId]
  );
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

export async function removeLine(invoiceId: string, lineId: string) {
  await assertDraft(invoiceId, "have lines removed");
  const { rowCount } = await query(
    "DELETE FROM saas_invoice_lines WHERE id = $1 AND invoice_id = $2",
    [lineId, invoiceId]
  );
  if (!rowCount) throw ApiError.notFound("Line not found");
  await recomputeTotals(invoiceId);
  return getInvoice(invoiceId);
}

export async function deleteDraft(invoiceId: string) {
  await assertDraft(invoiceId, "be deleted");
  await query("DELETE FROM saas_invoices WHERE id = $1", [invoiceId]);
  return { id: invoiceId, deleted: true };
}

export async function duplicateInvoice(invoiceId: string, createdBy: string) {
  const exists = await query("SELECT 1 FROM saas_invoices WHERE id = $1", [
    invoiceId,
  ]);
  if (!exists.rows[0]) throw ApiError.notFound("Invoice not found");
  const newId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO saas_invoices
         (institution_id, package_id, currency, period_start, period_end,
          payment_terms_days, due_date, tax_percent, gstin, billing_name,
          billing_address, tax_notes, notes, sac_code, place_of_supply,
          reverse_charge, recipient_state, recipient_state_code, created_by)
       SELECT institution_id, package_id, currency, period_start, period_end,
              payment_terms_days, NULL, tax_percent, gstin, billing_name,
              billing_address, tax_notes, notes, sac_code, place_of_supply,
              reverse_charge, recipient_state, recipient_state_code, $2
       FROM saas_invoices WHERE id = $1
       RETURNING id`,
      [invoiceId, createdBy]
    );
    const nid = ins.rows[0].id;
    await client.query(
      `INSERT INTO saas_invoice_lines (invoice_id, description, quantity, unit_price, sac_code, amount)
       SELECT $2, description, quantity, unit_price, sac_code, amount
       FROM saas_invoice_lines WHERE invoice_id = $1`,
      [invoiceId, nid]
    );
    return nid;
  });
  await recomputeTotals(newId);
  return getInvoice(newId);
}

/** Financial year label honouring a configurable start month, e.g. 'FY2026-27'. */
async function currentFyLabel(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: { label: string }[] }> },
  fyStartMonth: number
): Promise<string> {
  const { rows } = await client.query(
    `SELECT 'FY' || fy_start || '-' || lpad(((fy_start + 1) % 100)::text, 2, '0') AS label
     FROM (
       SELECT CASE WHEN extract(month FROM CURRENT_DATE) >= $1
                   THEN extract(year FROM CURRENT_DATE)::int
                   ELSE extract(year FROM CURRENT_DATE)::int - 1 END AS fy_start
     ) s`,
    [fyStartMonth]
  );
  return rows[0].label;
}

/**
 * Issue a draft: assign the next FY-segmented number (from settings: prefix /
 * padding / FY start), freeze totals, set the due date, snapshot the supplier
 * state, record the issuer, then best-effort email + log delivery.
 */
export async function issueInvoice(invoiceId: string, issuedBy?: string) {
  await assertDraft(invoiceId, "be issued");
  await recomputeTotals(invoiceId);
  const settings = await getSettings();
  const prefix = settings.prefix || env.saasInvoicePrefix;
  const padding = settings.numberPadding || 6;
  const fyStartMonth = settings.fyStartMonth || 4;
  await withTransaction(async (client) => {
    const label = await currentFyLabel(client as never, fyStartMonth);
    const ctr = await client.query<{ last_value: number }>(
      `INSERT INTO saas_invoice_counters (fy, last_value) VALUES ($1, 1)
       ON CONFLICT (fy) DO UPDATE SET last_value = saas_invoice_counters.last_value + 1
       RETURNING last_value`,
      [label]
    );
    const number = `${prefix}${label}-${String(ctr.rows[0].last_value).padStart(
      padding,
      "0"
    )}`;
    await client.query(
      `UPDATE saas_invoices SET
         status = 'issued', number = $2, issued_at = now(), issued_by = $3,
         supplier_state = $4, supplier_state_code = $5,
         due_date = COALESCE(
           due_date,
           CASE WHEN payment_terms_days IS NOT NULL
                THEN (CURRENT_DATE + payment_terms_days) ELSE NULL END
         )
       WHERE id = $1`,
      [
        invoiceId,
        number,
        issuedBy ?? null,
        settings.supplierState ?? null,
        settings.supplierStateCode ?? null,
      ]
    );
  });
  await notifyInvoiceIssued(invoiceId, issuedBy ?? null);
  return getInvoice(invoiceId);
}

/** Record one email delivery attempt (never throws into the caller). */
async function logEmail(
  invoiceId: string,
  recipient: string,
  status: "sent" | "failed" | "skipped",
  error: string | null,
  triggeredBy: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO invoice_emails (invoice_id, recipient, template, status, error, triggered_by)
       VALUES ($1,$2,'invoice_issued',$3,$4,$5)`,
      [invoiceId, recipient, status, error, triggeredBy]
    );
  } catch (err) {
    console.error("invoice_emails log failed (continuing):", err);
  }
}

/**
 * Best-effort "invoice issued" email to the institution's admins. Never throws;
 * each recipient attempt is recorded in invoice_emails. Returns the number sent.
 */
async function notifyInvoiceIssued(
  invoiceId: string,
  triggeredBy: string | null
): Promise<number> {
  let sent = 0;
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
    if (!inv) return 0;
    const admins = await query<{ email: string }>(
      `SELECT email FROM users
       WHERE institution_id = $1 AND role = 'admin' AND is_active = true`,
      [inv.institution_id]
    );
    const configured = mailerConfigured();
    for (const a of admins.rows) {
      if (!configured) {
        await logEmail(invoiceId, a.email, "skipped", "SMTP not configured", triggeredBy);
        continue;
      }
      try {
        await sendMail({
          to: a.email,
          subject: `Invoice ${inv.number} from ${env.saasCompanyName}`,
          text:
            `A new subscription invoice (${inv.number}) for ${inv.currency} ${inv.total} ` +
            `has been issued to your institution. Please contact your ${env.saasCompanyName} ` +
            `administrator for the PDF and payment details.`,
        });
        await logEmail(invoiceId, a.email, "sent", null, triggeredBy);
        sent++;
      } catch (err) {
        await logEmail(
          invoiceId,
          a.email,
          "failed",
          err instanceof Error ? err.message : String(err),
          triggeredBy
        );
      }
    }
    return sent;
  } catch (err) {
    console.error("invoice issued email failed (continuing):", err);
    return sent;
  }
}

export async function resendInvoice(invoiceId: string, triggeredBy?: string) {
  const status = await invoiceStatus(invoiceId);
  if (status !== "issued" && status !== "paid") {
    throw ApiError.badRequest("Only an issued or paid invoice can be re-sent");
  }
  const recipients = await notifyInvoiceIssued(invoiceId, triggeredBy ?? null);
  return { recipients };
}

export async function markPaid(invoiceId: string, input: MarkPaid, recordedBy?: string) {
  if ((await invoiceStatus(invoiceId)) !== "issued") {
    throw ApiError.badRequest("Only an issued invoice can be marked paid");
  }
  await query(
    `UPDATE saas_invoices
       SET status = 'paid', payment_method = $2, payment_reference = $3,
           paid_at = COALESCE($4::timestamptz, now()), recorded_by = $5
     WHERE id = $1`,
    [
      invoiceId,
      input.paymentMethod,
      input.reference ?? null,
      input.paidAt ?? null,
      recordedBy ?? null,
    ]
  );
  return getInvoice(invoiceId);
}

/** Void a draft or issued invoice with a required reason. Paid cannot be voided. */
export async function voidInvoice(invoiceId: string, reason: string, voidedBy?: string) {
  const status = await invoiceStatus(invoiceId);
  if (status === "paid") {
    throw ApiError.badRequest("A paid invoice cannot be voided");
  }
  if (status === "void") return getInvoice(invoiceId);
  await query(
    `UPDATE saas_invoices
       SET status = 'void', void_reason = $2, voided_by = $3, voided_at = now()
     WHERE id = $1`,
    [invoiceId, reason, voidedBy ?? null]
  );
  return getInvoice(invoiceId);
}

/** Render the invoice as a PDF (super-admin download). */
export async function invoicePdfBuffer(invoiceId: string): Promise<Buffer> {
  const settings = await getSettings();
  const { rows } = await query<InvoicePdfData & { institutionName: string }>(
    `SELECT i.number, i.status, i.currency,
            inst.name AS "institutionName",
            i.billing_name AS "billingName", i.billing_address AS "billingAddress",
            i.gstin,
            to_char(i.period_start, 'YYYY-MM-DD') AS "periodStart",
            to_char(i.period_end, 'YYYY-MM-DD') AS "periodEnd",
            to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
            (i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS "isOverdue",
            i.issued_at::text AS "issuedAt", i.paid_at::text AS "paidAt",
            i.payment_method AS "paymentMethod", i.payment_reference AS "paymentReference",
            i.subtotal::text AS subtotal, i.tax_percent::text AS "taxPercent",
            i.tax_amount::text AS "taxAmount", i.round_off::text AS "roundOff",
            i.total::text AS total,
            i.sac_code AS "sacCode", i.place_of_supply AS "placeOfSupply",
            i.reverse_charge AS "reverseCharge",
            i.recipient_state AS "recipientState", i.recipient_state_code AS "recipientStateCode",
            i.notes, i.tax_notes AS "taxNotes"
     FROM saas_invoices i
     JOIN institutions inst ON inst.id = i.institution_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  const lines = await query<InvoicePdfData["lines"][number]>(
    `SELECT description, quantity::text AS quantity,
            unit_price::text AS "unitPrice", sac_code AS "sacCode", amount::text AS amount
     FROM saas_invoice_lines WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  return invoicePdf({
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
