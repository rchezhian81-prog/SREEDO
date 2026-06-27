import type { z } from "zod";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { percentOf, toPaise, toRupees } from "../../utils/money";
import type {
  applyDiscountSchema,
  applyFineSchema,
  createCategorySchema,
  createDiscountSchema,
  createFineRuleSchema,
  createScheduleSchema,
  updateCategorySchema,
  updateScheduleSchema,
} from "./feedepth.schema";

/** Recompute an invoice's lifecycle status after its amount_due changes. */
function statusFor(amountDue: number, amountPaid: number, current: string): string {
  if (current === "cancelled") return "cancelled";
  if (amountPaid >= amountDue) return "paid";
  if (amountPaid > 0) return "partially_paid";
  return "pending";
}

// --- Fee categories ---

export async function listCategories(institutionId: string) {
  const { rows } = await query(
    `SELECT id, name, code, is_active AS "isActive", created_at AS "createdAt"
     FROM fee_categories WHERE institution_id = $1 ORDER BY name`,
    [institutionId]
  );
  return rows;
}

export async function createCategory(
  input: z.infer<typeof createCategorySchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO fee_categories (institution_id, name, code, is_active)
     VALUES ($1, $2, $3, COALESCE($4, true))
     RETURNING id, name, code, is_active AS "isActive", created_at AS "createdAt"`,
    [institutionId, input.name, input.code ?? null, input.isActive ?? null]
  );
  return rows[0];
}

export async function updateCategory(
  id: string,
  input: z.infer<typeof updateCategorySchema>,
  institutionId: string
) {
  const { rows } = await query(
    `UPDATE fee_categories SET
       name = COALESCE($3, name),
       code = COALESCE($4, code),
       is_active = COALESCE($5, is_active)
     WHERE id = $1 AND institution_id = $2
     RETURNING id, name, code, is_active AS "isActive", created_at AS "createdAt"`,
    [id, institutionId, input.name ?? null, input.code ?? null, input.isActive ?? null]
  );
  if (!rows[0]) throw ApiError.notFound("Fee category not found");
  return rows[0];
}

export async function deleteCategory(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM fee_categories WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Fee category not found");
}

// --- Fee schedules ---

const SCHEDULE_SELECT = `
  fs.id, fs.name, fs.category_id AS "categoryId", cat.name AS "categoryName",
  fs.amount, fs.term_type AS "termType", fs.term_label AS "termLabel",
  fs.due_date AS "dueDate", fs.academic_year_id AS "academicYearId",
  fs.class_id AS "classId", fs.section_id AS "sectionId",
  fs.program_id AS "programId", fs.semester_id AS "semesterId",
  fs.student_id AS "studentId", fs.is_active AS "isActive",
  fs.created_at AS "createdAt"`;

export async function listSchedules(institutionId: string) {
  const { rows } = await query(
    `SELECT ${SCHEDULE_SELECT}
     FROM fee_schedules fs
     LEFT JOIN fee_categories cat ON cat.id = fs.category_id
     WHERE fs.institution_id = $1 ORDER BY fs.created_at DESC`,
    [institutionId]
  );
  return rows;
}

export async function createSchedule(
  input: z.infer<typeof createScheduleSchema>,
  institutionId: string,
  userId: string
) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO fee_schedules
       (institution_id, name, category_id, amount, term_type, term_label, due_date,
        academic_year_id, class_id, section_id, program_id, semester_id, student_id, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'term'),$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      institutionId,
      input.name,
      input.categoryId ?? null,
      input.amount,
      input.termType ?? null,
      input.termLabel ?? null,
      input.dueDate,
      input.academicYearId ?? null,
      input.classId ?? null,
      input.sectionId ?? null,
      input.programId ?? null,
      input.semesterId ?? null,
      input.studentId ?? null,
      userId,
    ]
  );
  return getSchedule(rows[0].id, institutionId);
}

export async function updateSchedule(
  id: string,
  input: z.infer<typeof updateScheduleSchema>,
  institutionId: string
) {
  const { rowCount } = await query(
    `UPDATE fee_schedules SET
       name = COALESCE($3, name),
       amount = COALESCE($4, amount),
       term_label = COALESCE($5, term_label),
       due_date = COALESCE($6, due_date),
       is_active = COALESCE($7, is_active)
     WHERE id = $1 AND institution_id = $2`,
    [
      id,
      institutionId,
      input.name ?? null,
      input.amount ?? null,
      input.termLabel ?? null,
      input.dueDate ?? null,
      input.isActive ?? null,
    ]
  );
  if (!rowCount) throw ApiError.notFound("Fee schedule not found");
  return getSchedule(id, institutionId);
}

async function getSchedule(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${SCHEDULE_SELECT}
     FROM fee_schedules fs
     LEFT JOIN fee_categories cat ON cat.id = fs.category_id
     WHERE fs.id = $1 AND fs.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Fee schedule not found");
  return rows[0];
}

/** Active students matched by the schedule's (AND-combined) targets. */
async function targetStudents(schedule: Record<string, unknown>, institutionId: string) {
  const { rows } = await query<{ id: string; name: string; alreadyInvoiced: boolean }>(
    `SELECT s.id, s.first_name || ' ' || s.last_name AS name,
            EXISTS (SELECT 1 FROM invoices i
                    WHERE i.fee_schedule_id = $2 AND i.student_id = s.id) AS "alreadyInvoiced"
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN enrollments e ON e.student_id = s.id AND e.institution_id = $1
     WHERE s.institution_id = $1 AND s.status = 'active'
       AND ($3::uuid IS NULL OR s.id = $3)
       AND ($4::uuid IS NULL OR s.section_id = $4)
       AND ($5::uuid IS NULL OR sec.class_id = $5)
       AND ($6::uuid IS NULL OR e.program_id = $6)
       AND ($7::uuid IS NULL OR e.semester_id = $7)
     GROUP BY s.id
     ORDER BY name`,
    [
      institutionId,
      schedule.id,
      schedule.studentId ?? null,
      schedule.sectionId ?? null,
      schedule.classId ?? null,
      schedule.programId ?? null,
      schedule.semesterId ?? null,
    ]
  );
  return rows;
}

export async function previewSchedule(id: string, institutionId: string) {
  const schedule = await getSchedule(id, institutionId);
  const students = await targetStudents(schedule, institutionId);
  return {
    schedule,
    targetCount: students.length,
    toGenerate: students.filter((s) => !s.alreadyInvoiced).length,
    students,
  };
}

export async function generateInvoices(id: string, institutionId: string) {
  const schedule = await getSchedule(id, institutionId);
  const description = schedule.termLabel
    ? `${schedule.name} (${schedule.termLabel})`
    : (schedule.name as string);

  // One invoice per (schedule, student); NOT EXISTS makes re-runs idempotent.
  const { rows } = await query<{ id: string }>(
    `INSERT INTO invoices
       (institution_id, invoice_no, student_id, description, amount_due, due_date,
        category_id, fee_schedule_id)
     SELECT $1,
            'INV-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
            s.id, $2, $3, $4, $5, $6
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN enrollments e ON e.student_id = s.id AND e.institution_id = $1
     WHERE s.institution_id = $1 AND s.status = 'active'
       AND ($7::uuid IS NULL OR s.id = $7)
       AND ($8::uuid IS NULL OR s.section_id = $8)
       AND ($9::uuid IS NULL OR sec.class_id = $9)
       AND ($10::uuid IS NULL OR e.program_id = $10)
       AND ($11::uuid IS NULL OR e.semester_id = $11)
       AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE i.fee_schedule_id = $6 AND i.student_id = s.id
       )
     GROUP BY s.id
     RETURNING id`,
    [
      institutionId,
      description,
      schedule.amount,
      schedule.dueDate,
      schedule.categoryId ?? null,
      schedule.id,
      schedule.studentId ?? null,
      schedule.sectionId ?? null,
      schedule.classId ?? null,
      schedule.programId ?? null,
      schedule.semesterId ?? null,
    ]
  );
  return { scheduleId: id, created: rows.length };
}

// --- Fine rules + application ---

export async function listFineRules(institutionId: string) {
  const { rows } = await query(
    `SELECT fr.id, fr.name, fr.category_id AS "categoryId", cat.name AS "categoryName",
            fr.fine_type AS "fineType", fr.amount, fr.grace_days AS "graceDays",
            fr.is_active AS "isActive", fr.created_at AS "createdAt"
     FROM fee_fine_rules fr
     LEFT JOIN fee_categories cat ON cat.id = fr.category_id
     WHERE fr.institution_id = $1 ORDER BY fr.name`,
    [institutionId]
  );
  return rows;
}

export async function createFineRule(
  input: z.infer<typeof createFineRuleSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO fee_fine_rules (institution_id, name, category_id, fine_type, amount, grace_days)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0))
     RETURNING id, name, category_id AS "categoryId", fine_type AS "fineType",
               amount, grace_days AS "graceDays", is_active AS "isActive"`,
    [
      institutionId,
      input.name,
      input.categoryId ?? null,
      input.fineType,
      input.amount,
      input.graceDays ?? null,
    ]
  );
  return rows[0];
}

interface InvoiceRow {
  id: string;
  student_id: string;
  amount_due: string;
  amount_paid: string;
  discount_total: string;
  fine_total: string;
  status: string;
  due_date: string;
}

async function lockInvoice(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  invoiceId: string,
  institutionId: string
): Promise<InvoiceRow> {
  const { rows } = await client.query<InvoiceRow>(
    `SELECT id, student_id, amount_due, amount_paid, discount_total, fine_total, status,
            to_char(due_date,'YYYY-MM-DD') AS due_date
     FROM invoices WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
    [invoiceId, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Invoice not found");
  return rows[0];
}

export async function applyFine(
  invoiceId: string,
  input: z.infer<typeof applyFineSchema>,
  userId: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const inv = await lockInvoice(client, invoiceId, institutionId);
    const amountDuePaise = toPaise(inv.amount_due);
    const basePaise =
      amountDuePaise + toPaise(inv.discount_total) - toPaise(inv.fine_total);

    let fineAmountPaise = input.amount != null ? toPaise(input.amount) : 0;
    let days: number | null = null;
    let ruleId: string | null = null;

    if (input.amount == null) {
      if (!input.fineRuleId) throw ApiError.badRequest("Provide a fineRuleId or amount");
      const { rows } = await client.query<{
        fine_type: string;
        amount: string;
        grace_days: number;
      }>(
        "SELECT fine_type, amount, grace_days FROM fee_fine_rules WHERE id = $1 AND institution_id = $2",
        [input.fineRuleId, institutionId]
      );
      const rule = rows[0];
      if (!rule) throw ApiError.notFound("Fine rule not found");
      ruleId = input.fineRuleId;
      const today = new Date();
      const due = new Date(inv.due_date + "T00:00:00Z");
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
      const eff = Math.max(0, daysOverdue - rule.grace_days);
      const overdue = daysOverdue > rule.grace_days;
      if (rule.fine_type === "fixed") fineAmountPaise = overdue ? toPaise(rule.amount) : 0;
      else if (rule.fine_type === "per_day") fineAmountPaise = toPaise(rule.amount) * eff;
      else fineAmountPaise = overdue ? percentOf(basePaise, Number(rule.amount)) : 0;
      days = eff;

      const dup = await client.query(
        "SELECT 1 FROM invoice_fines WHERE invoice_id = $1 AND fine_rule_id = $2 AND status = 'applied'",
        [invoiceId, ruleId]
      );
      if (dup.rows[0]) throw ApiError.badRequest("This fine rule is already applied to the invoice");
    }

    if (fineAmountPaise <= 0) throw ApiError.badRequest("No fine is applicable for this invoice");
    const fineAmount = toRupees(fineAmountPaise);

    const { rows: fineRows } = await client.query(
      `INSERT INTO invoice_fines
         (institution_id, invoice_id, fine_rule_id, amount, days, reason, applied_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, amount, days, status`,
      [institutionId, invoiceId, ruleId, fineAmount, days, input.reason ?? null, userId]
    );

    const newDue = toRupees(amountDuePaise + fineAmountPaise);
    await client.query(
      "UPDATE invoices SET amount_due = $1, fine_total = fine_total + $2, status = $3 WHERE id = $4",
      [newDue, fineAmount, statusFor(newDue, Number(inv.amount_paid), inv.status), invoiceId]
    );
    return { fine: fineRows[0], invoiceId, amountDue: newDue };
  });
}

/** Applies each active fine rule to every overdue, unpaid invoice (idempotent). */
export async function applyOverdueFines(institutionId: string, userId: string) {
  const rules = await query<{ id: string }>(
    "SELECT id FROM fee_fine_rules WHERE institution_id = $1 AND is_active = true",
    [institutionId]
  );
  const overdue = await query<{ id: string }>(
    `SELECT id FROM invoices
     WHERE institution_id = $1 AND status IN ('pending','partially_paid')
       AND due_date < CURRENT_DATE`,
    [institutionId]
  );
  let applied = 0;
  for (const inv of overdue.rows) {
    for (const rule of rules.rows) {
      try {
        await applyFine(inv.id, { fineRuleId: rule.id }, userId, institutionId);
        applied++;
      } catch {
        // already applied or not applicable — skip
      }
    }
  }
  return { applied };
}

export async function waiveFine(
  fineId: string,
  userId: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      invoice_id: string;
      amount: string;
      status: string;
    }>(
      "SELECT invoice_id, amount, status FROM invoice_fines WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [fineId, institutionId]
    );
    const fine = rows[0];
    if (!fine) throw ApiError.notFound("Applied fine not found");
    if (fine.status !== "applied") throw ApiError.badRequest("Fine is not in an applied state");

    const inv = await lockInvoice(client, fine.invoice_id, institutionId);
    const newDue = toRupees(toPaise(inv.amount_due) - toPaise(fine.amount));
    await client.query(
      "UPDATE invoices SET amount_due = $1, fine_total = fine_total - $2, status = $3 WHERE id = $4",
      [newDue, Number(fine.amount), statusFor(newDue, Number(inv.amount_paid), inv.status), fine.invoice_id]
    );
    await client.query(
      "UPDATE invoice_fines SET status = 'waived', waived_by = $2 WHERE id = $1",
      [fineId, userId]
    );
    return { fineId, invoiceId: fine.invoice_id, amountDue: newDue };
  });
}

// --- Discounts / scholarships ---

export async function listDiscounts(institutionId: string) {
  const { rows } = await query(
    `SELECT d.id, d.name, d.kind, d.discount_type AS "discountType", d.value,
            d.category_id AS "categoryId", d.is_active AS "isActive", d.created_at AS "createdAt"
     FROM fee_discounts d WHERE d.institution_id = $1 ORDER BY d.name`,
    [institutionId]
  );
  return rows;
}

export async function createDiscount(
  input: z.infer<typeof createDiscountSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO fee_discounts (institution_id, name, kind, discount_type, value, category_id)
     VALUES ($1,$2,COALESCE($3,'discount'),$4,$5,$6)
     RETURNING id, name, kind, discount_type AS "discountType", value,
               category_id AS "categoryId", is_active AS "isActive"`,
    [institutionId, input.name, input.kind ?? null, input.discountType, input.value, input.categoryId ?? null]
  );
  return rows[0];
}

export async function applyDiscount(
  invoiceId: string,
  input: z.infer<typeof applyDiscountSchema>,
  userId: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const inv = await lockInvoice(client, invoiceId, institutionId);
    const amountDuePaise = toPaise(inv.amount_due);
    const basePaise =
      amountDuePaise + toPaise(inv.discount_total) - toPaise(inv.fine_total);

    let type = input.discountType;
    let value = input.value;
    let discountId: string | null = null;
    if (input.discountId) {
      const { rows } = await client.query<{ discount_type: string; value: string }>(
        "SELECT discount_type, value FROM fee_discounts WHERE id = $1 AND institution_id = $2",
        [input.discountId, institutionId]
      );
      const rule = rows[0];
      if (!rule) throw ApiError.notFound("Discount not found");
      discountId = input.discountId;
      type = rule.discount_type as "fixed" | "percent";
      value = Number(rule.value);
    }
    if (type == null || value == null) throw ApiError.badRequest("Discount type and value are required");

    const amountPaise = type === "percent" ? percentOf(basePaise, value) : toPaise(value);
    if (amountPaise <= 0) throw ApiError.badRequest("Discount amount must be positive");
    if (amountPaise > amountDuePaise)
      throw ApiError.badRequest("Discount exceeds the invoice's payable amount");
    const amount = toRupees(amountPaise);

    const { rows } = await client.query(
      `INSERT INTO invoice_discounts
         (institution_id, invoice_id, discount_id, student_id, amount, status, reason, applied_by)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)
       RETURNING id, amount, status, reason`,
      [institutionId, invoiceId, discountId, inv.student_id, amount, input.reason ?? null, userId]
    );
    return { discount: rows[0], invoiceId };
  });
}

export async function approveDiscount(
  appliedId: string,
  userId: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      invoice_id: string;
      amount: string;
      status: string;
    }>(
      "SELECT invoice_id, amount, status FROM invoice_discounts WHERE id = $1 AND institution_id = $2 FOR UPDATE",
      [appliedId, institutionId]
    );
    const disc = rows[0];
    if (!disc) throw ApiError.notFound("Applied discount not found");
    if (disc.status !== "pending") throw ApiError.badRequest("Discount is not pending approval");

    const inv = await lockInvoice(client, disc.invoice_id, institutionId);
    const amount = Number(disc.amount);
    if (toPaise(disc.amount) > toPaise(inv.amount_due)) {
      throw ApiError.badRequest("Discount exceeds the invoice's current payable amount");
    }
    const newDue = toRupees(toPaise(inv.amount_due) - toPaise(disc.amount));
    await client.query(
      "UPDATE invoices SET amount_due = $1, discount_total = discount_total + $2, status = $3 WHERE id = $4",
      [newDue, amount, statusFor(newDue, Number(inv.amount_paid), inv.status), disc.invoice_id]
    );
    await client.query(
      "UPDATE invoice_discounts SET status = 'approved', approved_by = $2 WHERE id = $1",
      [appliedId, userId]
    );
    return { discountId: appliedId, invoiceId: disc.invoice_id, amountDue: newDue };
  });
}

// --- Breakdown (owner-scoped via the route) ---

export async function invoiceBreakdown(invoiceId: string, institutionId: string) {
  const { rows } = await query<{
    id: string;
    studentId: string;
    invoiceNo: string;
    amountDue: string;
    amountPaid: string;
    discountTotal: string;
    fineTotal: string;
    status: string;
    categoryName: string | null;
  }>(
    `SELECT i.id, i.student_id AS "studentId", i.invoice_no AS "invoiceNo",
            i.amount_due AS "amountDue", i.amount_paid AS "amountPaid",
            i.discount_total AS "discountTotal", i.fine_total AS "fineTotal",
            i.status, cat.name AS "categoryName"
     FROM invoices i LEFT JOIN fee_categories cat ON cat.id = i.category_id
     WHERE i.id = $1 AND i.institution_id = $2`,
    [invoiceId, institutionId]
  );
  const inv = rows[0];
  if (!inv) throw ApiError.notFound("Invoice not found");

  const fines = await query(
    `SELECT id, amount, days, status, reason, created_at AS "createdAt"
     FROM invoice_fines WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  const discounts = await query(
    `SELECT id, amount, status, reason, created_at AS "createdAt"
     FROM invoice_discounts WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId]
  );
  const base = toRupees(
    toPaise(inv.amountDue) + toPaise(inv.discountTotal) - toPaise(inv.fineTotal)
  );
  return {
    invoice: inv,
    studentId: inv.studentId,
    base,
    discountTotal: Number(inv.discountTotal),
    fineTotal: Number(inv.fineTotal),
    outstanding: toRupees(toPaise(inv.amountDue) - toPaise(inv.amountPaid)),
    fines: fines.rows,
    discounts: discounts.rows,
  };
}
