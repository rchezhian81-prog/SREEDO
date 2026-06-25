import crypto from "node:crypto";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { sendMail } from "../../utils/mailer";
import { toPaise, toRupees } from "../../utils/money";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createFeeStructureSchema,
  createInvoiceSchema,
  recordPaymentSchema,
} from "./fees.schema";

const INVOICE_SELECT = `
  i.id,
  i.invoice_no AS "invoiceNo",
  i.student_id AS "studentId",
  s.first_name || ' ' || s.last_name AS "studentName",
  s.admission_no AS "admissionNo",
  i.description,
  i.amount_due AS "amountDue",
  i.amount_paid AS "amountPaid",
  i.due_date AS "dueDate",
  i.status,
  i.created_at AS "createdAt"
FROM invoices i
JOIN students s ON s.id = i.student_id`;

function generateInvoiceNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// --- Fee structures ---

export async function listFeeStructures(institutionId: string) {
  const { rows } = await query(
    `SELECT fs.id, fs.name, fs.class_id AS "classId", c.name AS "className",
            fs.academic_year_id AS "academicYearId", fs.amount, fs.frequency
     FROM fee_structures fs
     LEFT JOIN classes c ON c.id = fs.class_id
     WHERE fs.institution_id = $1
     ORDER BY fs.created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function createFeeStructure(
  input: z.infer<typeof createFeeStructureSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO fee_structures (institution_id, name, class_id, academic_year_id, amount, frequency)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, class_id AS "classId",
               academic_year_id AS "academicYearId", amount, frequency`,
    [
      institutionId,
      input.name,
      input.classId ?? null,
      input.academicYearId ?? null,
      input.amount,
      input.frequency ?? "term",
    ]
  );
  return rows[0];
}

// --- Invoices ---

export async function listInvoices(
  pagination: Pagination,
  filters: { studentId?: string; status?: string },
  institutionId: string,
  restrictIds?: string[] | null
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["i.institution_id = $1"];
  if (filters.studentId) {
    params.push(filters.studentId);
    conditions.push(`i.student_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`i.status = $${params.length}`);
  }
  // Owner-scoping: restrict to a set of student ids (student/parent).
  if (restrictIds != null) {
    params.push(restrictIds);
    conditions.push(`i.student_id = ANY($${params.length}::uuid[])`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM invoices i ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${INVOICE_SELECT} ${where}
     ORDER BY i.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getInvoice(id: string, institutionId: string) {
  const { rows } = await query<{ studentId: string }>(
    `SELECT ${INVOICE_SELECT} WHERE i.id = $1 AND i.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  const payments = await query(
    `SELECT id, amount, method, reference, paid_at AS "paidAt"
     FROM payments WHERE invoice_id = $1 ORDER BY paid_at DESC`,
    [id]
  );
  return { ...rows[0], payments: payments.rows };
}

export async function createInvoice(
  input: z.infer<typeof createInvoiceSchema>,
  institutionId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO invoices (institution_id, invoice_no, student_id, fee_structure_id, description, amount_due, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      institutionId,
      generateInvoiceNo(),
      input.studentId,
      input.feeStructureId ?? null,
      input.description,
      input.amountDue,
      input.dueDate,
    ]
  );
  return getInvoice(rows[0].id, institutionId);
}

// --- Payments ---

export async function recordPayment(
  invoiceId: string,
  input: z.infer<typeof recordPaymentSchema>,
  receivedBy: string,
  institutionId: string
) {
  const result = await withTransaction(async (client) => {
    // Lock the invoice row so concurrent payments serialise on amount_paid.
    const { rows } = await client.query(
      `SELECT amount_due, amount_paid, status
       FROM invoices WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
      [invoiceId, institutionId]
    );
    const invoice = rows[0];
    if (!invoice) throw ApiError.notFound("Invoice not found");
    if (invoice.status === "cancelled") {
      throw ApiError.badRequest("Cannot pay a cancelled invoice");
    }

    const amountDuePaise = toPaise(invoice.amount_due);
    const outstandingPaise = amountDuePaise - toPaise(invoice.amount_paid);
    const amountPaise = toPaise(input.amount);
    if (amountPaise > outstandingPaise) {
      throw ApiError.badRequest(
        `Payment exceeds outstanding balance of ${toRupees(outstandingPaise).toFixed(2)}`
      );
    }
    const amount = toRupees(amountPaise);

    await client.query(
      `INSERT INTO payments (institution_id, invoice_id, amount, method, reference, received_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [institutionId, invoiceId, amount, input.method ?? "cash", input.reference ?? null, receivedBy]
    );

    const newPaidPaise = toPaise(invoice.amount_paid) + amountPaise;
    const newPaid = toRupees(newPaidPaise);
    const newStatus =
      newPaidPaise >= amountDuePaise ? "paid" : "partially_paid";
    await client.query(
      "UPDATE invoices SET amount_paid = $1, status = $2 WHERE id = $3",
      [newPaid, newStatus, invoiceId]
    );
    return { invoiceId, newStatus };
  });

  // Receipt email is best-effort and must not fail the payment.
  void sendReceiptEmail(invoiceId, input.amount);
  return getInvoice(result.invoiceId, institutionId);
}

async function sendReceiptEmail(invoiceId: string, amount: number) {
  const { rows } = await query<{
    invoice_no: string;
    guardian_email: string | null;
    first_name: string;
    last_name: string;
  }>(
    `SELECT i.invoice_no, s.guardian_email, s.first_name, s.last_name
     FROM invoices i JOIN students s ON s.id = i.student_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  const row = rows[0];
  if (!row?.guardian_email) return;
  await sendMail({
    to: row.guardian_email,
    subject: `Payment received — ${row.invoice_no}`,
    text: `Dear guardian of ${row.first_name} ${row.last_name},\n\nWe have received a payment of ${amount.toFixed(
      2
    )} against invoice ${row.invoice_no}. Thank you.\n\n— SRE EDU OS`,
  });
}

// --- Summary ---

export async function feeSummary(institutionId: string) {
  const { rows } = await query<{
    total_invoiced: string | null;
    total_collected: string | null;
    pending_invoices: string;
  }>(
    `SELECT
       (SELECT sum(amount_due) FROM invoices WHERE institution_id = $1 AND status <> 'cancelled') AS total_invoiced,
       (SELECT sum(amount) FROM payments WHERE institution_id = $1) AS total_collected,
       (SELECT count(*) FROM invoices WHERE institution_id = $1 AND status IN ('pending', 'partially_paid')) AS pending_invoices`,
    [institutionId]
  );
  const row = rows[0];
  return {
    totalInvoiced: Number(row.total_invoiced ?? 0),
    totalCollected: Number(row.total_collected ?? 0),
    outstanding: Number(row.total_invoiced ?? 0) - Number(row.total_collected ?? 0),
    pendingInvoices: Number(row.pending_invoices),
  };
}
