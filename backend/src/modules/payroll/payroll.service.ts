import type { Request } from "express";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { storage } from "../../utils/storage";
import type { PdfImage } from "../../utils/pdf";
import { payrollSummary, teacherIdForUser } from "../staffleave/staffleave.service";
import type { z } from "zod";
import type {
  createComponentSchema,
  createStructureSchema,
  runPayrollSchema,
  updateComponentSchema,
} from "./payroll.schema";
import { payslipPdf } from "./payroll.pdf";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}
const round2 = (n: number) => Math.round(n * 100) / 100;

function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (input[field] !== undefined) {
      params.push(input[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

async function getImage(
  ownerType: string,
  ownerId: string,
  category: string,
  institutionId: string
): Promise<PdfImage | null> {
  try {
    const { rows } = await query<{ storage_key: string; mime_type: string }>(
      `SELECT storage_key, mime_type FROM documents
       WHERE institution_id = $1 AND owner_type = $2 AND owner_id = $3 AND category = $4
       ORDER BY created_at DESC LIMIT 1`,
      [institutionId, ownerType, ownerId, category]
    );
    if (!rows[0]) return null;
    return { buffer: await storage.get(rows[0].storage_key), mime: rows[0].mime_type };
  } catch {
    return null;
  }
}

// --- Salary components ---

const COMP_COLS = `id, name, code, type, calc_type AS "calcType", default_value AS "defaultValue", is_active AS "isActive"`;

export async function listComponents(institutionId: string) {
  const { rows } = await query(
    `SELECT ${COMP_COLS} FROM salary_components WHERE institution_id = $1 ORDER BY type, name`,
    [institutionId]
  );
  return rows;
}

export async function createComponent(
  input: z.infer<typeof createComponentSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO salary_components (institution_id, name, code, type, calc_type, default_value, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'fixed'), COALESCE($6, 0), COALESCE($7, true))
       RETURNING ${COMP_COLS}`,
      [institutionId, input.name, input.code, input.type, input.calcType ?? null, input.defaultValue ?? null, input.isActive ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A component with that code exists");
    throw err;
  }
}

export async function updateComponent(
  id: string,
  input: z.infer<typeof updateComponentSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    { name: "name", code: "code", calcType: "calc_type", defaultValue: "default_value", isActive: "is_active" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE salary_components SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING ${COMP_COLS}`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Component not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A component with that code exists");
    throw err;
  }
}

export async function deleteComponent(id: string, institutionId: string) {
  const used = await query(
    "SELECT 1 FROM salary_structure_components WHERE component_id = $1 AND institution_id = $2 LIMIT 1",
    [id, institutionId]
  );
  if (used.rows[0]) throw ApiError.conflict("Component is in use by a salary structure");
  const { rowCount } = await query(
    "DELETE FROM salary_components WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Component not found");
}

// --- Salary structures ---

export async function listStructures(institutionId: string, teacherId?: string) {
  const params: unknown[] = [institutionId];
  let where = "s.institution_id = $1";
  if (teacherId) {
    params.push(teacherId);
    where += ` AND s.teacher_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT s.id, s.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            t.employee_no AS "employeeNo", s.effective_date AS "effectiveDate", s.is_active AS "isActive",
            (SELECT COALESCE(sum(CASE WHEN c.type = 'earning' AND ssc.calc_type = 'fixed' THEN ssc.value ELSE 0 END), 0)
             FROM salary_structure_components ssc JOIN salary_components c ON c.id = ssc.component_id
             WHERE ssc.structure_id = s.id) AS "fixedEarnings"
     FROM salary_structures s JOIN teachers t ON t.id = s.teacher_id
     WHERE ${where} ORDER BY t.first_name, s.effective_date DESC`,
    params
  );
  return rows;
}

export async function getStructure(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT s.id, s.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            s.effective_date AS "effectiveDate", s.is_active AS "isActive"
     FROM salary_structures s JOIN teachers t ON t.id = s.teacher_id
     WHERE s.id = $1 AND s.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Salary structure not found");
  const lines = await query(
    `SELECT ssc.id, ssc.component_id AS "componentId", c.name, c.code, c.type,
            ssc.calc_type AS "calcType", ssc.value
     FROM salary_structure_components ssc JOIN salary_components c ON c.id = ssc.component_id
     WHERE ssc.structure_id = $1 AND ssc.institution_id = $2 ORDER BY c.type, c.name`,
    [id, institutionId]
  );
  return { ...rows[0], components: lines.rows };
}

export async function createStructure(
  input: z.infer<typeof createStructureSchema>,
  institutionId: string
) {
  const t = await query("SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2", [
    input.teacherId,
    institutionId,
  ]);
  if (!t.rows[0]) throw ApiError.badRequest("Invalid staff member");
  for (const line of input.components) {
    const c = await query(
      "SELECT calc_type FROM salary_components WHERE id = $1 AND institution_id = $2",
      [line.componentId, institutionId]
    );
    if (!c.rows[0]) throw ApiError.badRequest("Invalid salary component");
  }
  return withTransaction(async (client) => {
    // New active structure supersedes the previous one (revision history).
    await client.query(
      "UPDATE salary_structures SET is_active = false WHERE institution_id = $1 AND teacher_id = $2 AND is_active = true",
      [institutionId, input.teacherId]
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO salary_structures (institution_id, teacher_id, effective_date)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE)) RETURNING id`,
      [institutionId, input.teacherId, input.effectiveDate ?? null]
    );
    const structureId = rows[0].id;
    for (const line of input.components) {
      await client.query(
        `INSERT INTO salary_structure_components (institution_id, structure_id, component_id, calc_type, value)
         VALUES ($1, $2, $3, COALESCE($4, 'fixed'), $5)`,
        [institutionId, structureId, line.componentId, line.calcType ?? null, line.value]
      );
    }
    return { id: structureId, teacherId: input.teacherId, components: input.components.length };
  });
}

export async function deleteStructure(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM salary_structures WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Salary structure not found");
}

// --- Payroll computation ---

interface StructLine {
  component_id: string;
  calc_type: string;
  value: number;
  name: string;
  type: string;
}
interface Attendance {
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  lateCount: number;
}
const ZERO_ATT: Attendance = {
  workingDays: 0, presentDays: 0, absentDays: 0, halfDays: 0, paidLeave: 0, unpaidLeave: 0, lateCount: 0,
};

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

interface ComputedLine { componentId: string | null; name: string; type: "earning" | "deduction"; amount: number; }

function computePayslip(lines: StructLine[], att: Attendance, month: string) {
  // Percentage components are computed on the fixed-earnings total ("basic").
  const percentBase = lines
    .filter((l) => l.type === "earning" && l.calc_type === "fixed")
    .reduce((s, l) => s + Number(l.value), 0);

  const computed: ComputedLine[] = lines.map((l) => ({
    componentId: l.component_id,
    name: l.name,
    type: l.type as "earning" | "deduction",
    amount: l.calc_type === "fixed" ? round2(Number(l.value)) : round2((Number(l.value) / 100) * percentBase),
  }));

  const gross = round2(computed.filter((l) => l.type === "earning").reduce((s, l) => s + l.amount, 0));
  let deductions = round2(computed.filter((l) => l.type === "deduction").reduce((s, l) => s + l.amount, 0));

  // Auto unpaid-leave deduction (per-day of gross × unpaid days).
  if (att.unpaidLeave > 0 && gross > 0) {
    const perDay = gross / daysInMonth(month);
    const unpaidDeduction = round2(perDay * att.unpaidLeave);
    if (unpaidDeduction > 0) {
      computed.push({ componentId: null, name: "Unpaid Leave", type: "deduction", amount: unpaidDeduction });
      deductions = round2(deductions + unpaidDeduction);
    }
  }
  const net = round2(gross - deductions);
  return { gross, deductions, net, lines: computed };
}

// --- Payroll runs ---

export async function listRuns(institutionId: string) {
  const { rows } = await query(
    `SELECT r.id, r.month, r.status, r.notes, r.finalized_at AS "finalizedAt",
            (SELECT count(*)::int FROM payslips p WHERE p.run_id = r.id) AS "payslipCount",
            (SELECT COALESCE(sum(net), 0) FROM payslips p WHERE p.run_id = r.id) AS "netTotal"
     FROM payroll_runs r WHERE r.institution_id = $1 ORDER BY r.month DESC`,
    [institutionId]
  );
  return rows;
}

export async function runPayroll(
  input: z.infer<typeof runPayrollSchema>,
  runBy: string,
  institutionId: string
) {
  const monthDate = `${input.month}-01`;
  const summary = (await payrollSummary(institutionId, input.month)) as Array<
    Attendance & { teacherId: string }
  >;
  const attMap = new Map(summary.map((s) => [s.teacherId, s]));

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO payroll_runs (institution_id, month, created_by)
       VALUES ($1, $2, $3) ON CONFLICT (institution_id, month) DO NOTHING`,
      [institutionId, monthDate, runBy]
    );
    const runRes = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM payroll_runs WHERE institution_id = $1 AND month = $2 FOR UPDATE",
      [institutionId, monthDate]
    );
    const run = runRes.rows[0];
    if (run.status === "finalized")
      throw ApiError.conflict("Payroll for this month is finalized");

    const { rows: lineRows } = await client.query<StructLine & { teacher_id: string }>(
      `SELECT s.teacher_id, ssc.component_id, ssc.calc_type, ssc.value, c.name, c.type
       FROM salary_structures s
       JOIN salary_structure_components ssc ON ssc.structure_id = s.id
       JOIN salary_components c ON c.id = ssc.component_id
       WHERE s.institution_id = $1 AND s.is_active = true`,
      [institutionId]
    );
    const byTeacher = new Map<string, StructLine[]>();
    for (const r of lineRows) {
      if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
      byTeacher.get(r.teacher_id)!.push(r);
    }

    let generated = 0;
    let skipped = 0;
    for (const [teacherId, lines] of byTeacher) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM payslips WHERE institution_id = $1 AND teacher_id = $2 AND month = $3",
        [institutionId, teacherId, monthDate]
      );
      if (existing.rows[0]) {
        if (!input.recalc) {
          skipped++;
          continue;
        }
        await client.query("DELETE FROM payslips WHERE id = $1", [existing.rows[0].id]);
      }
      const att = attMap.get(teacherId) ?? ZERO_ATT;
      const c = computePayslip(lines, att, input.month);
      const ps = await client.query<{ id: string }>(
        `INSERT INTO payslips (institution_id, run_id, teacher_id, month, working_days, present_days,
                               absent_days, paid_leave, unpaid_leave, half_days, late_count, gross, deductions, net)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          institutionId, run.id, teacherId, monthDate, att.workingDays, att.presentDays,
          att.absentDays, att.paidLeave, att.unpaidLeave, att.halfDays, att.lateCount,
          c.gross, c.deductions, c.net,
        ]
      );
      for (const l of c.lines) {
        await client.query(
          `INSERT INTO payslip_lines (institution_id, payslip_id, component_id, name, type, amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [institutionId, ps.rows[0].id, l.componentId, l.name, l.type, l.amount]
        );
      }
      generated++;
    }
    return { runId: run.id, month: monthDate, generated, skipped, status: run.status };
  });
}

export async function finalizeRun(id: string, finalizedBy: string, institutionId: string) {
  return withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE payroll_runs SET status = 'finalized', finalized_by = $2, finalized_at = now()
       WHERE id = $1 AND institution_id = $3 AND status = 'draft'
       RETURNING id, month, status`,
      [id, finalizedBy, institutionId]
    );
    if (!r.rows[0]) throw ApiError.conflict("Run not found or already finalized");
    await client.query("UPDATE payslips SET status = 'finalized' WHERE run_id = $1", [id]);
    return r.rows[0];
  });
}

// --- Payslips ---

export async function listPayslips(
  institutionId: string,
  filters: { runId?: string; teacherId?: string; month?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["p.institution_id = $1"];
  if (filters.runId) {
    params.push(filters.runId);
    where.push(`p.run_id = $${params.length}`);
  }
  if (filters.teacherId) {
    params.push(filters.teacherId);
    where.push(`p.teacher_id = $${params.length}`);
  }
  if (filters.month) {
    params.push(`${filters.month}-01`);
    where.push(`p.month = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT p.id, p.teacher_id AS "teacherId", t.first_name || ' ' || t.last_name AS "teacherName",
            t.employee_no AS "employeeNo", p.month, p.working_days AS "workingDays",
            p.present_days AS "presentDays", p.absent_days AS "absentDays", p.paid_leave AS "paidLeave",
            p.unpaid_leave AS "unpaidLeave", p.half_days AS "halfDays",
            p.gross, p.deductions, p.net, p.status
     FROM payslips p JOIN teachers t ON t.id = p.teacher_id
     WHERE ${where.join(" AND ")} ORDER BY t.first_name`,
    params
  );
  return rows;
}

/** Payslips for the signed-in staff member (owner-scoped portal view). */
export async function myPayslips(userId: string, institutionId: string) {
  const teacherId = await teacherIdForUser(userId, institutionId);
  if (!teacherId) return [];
  return listPayslips(institutionId, { teacherId });
}

async function loadPayslip(id: string, institutionId: string) {
  const { rows } = await query<{
    id: string;
    teacher_id: string;
    month: string;
    working_days: number;
    present_days: number;
    absent_days: number;
    paid_leave: number;
    unpaid_leave: number;
    half_days: number;
    gross: string;
    deductions: string;
    net: string;
    status: string;
    first_name: string;
    last_name: string;
    employee_no: string;
    institution_name: string;
  }>(
    `SELECT p.*, t.first_name, t.last_name, t.employee_no, inst.name AS institution_name
     FROM payslips p JOIN teachers t ON t.id = p.teacher_id
     JOIN institutions inst ON inst.id = p.institution_id
     WHERE p.id = $1 AND p.institution_id = $2`,
    [id, institutionId]
  );
  return rows[0] ?? null;
}

export async function getPayslip(id: string, institutionId: string) {
  const p = await loadPayslip(id, institutionId);
  if (!p) throw ApiError.notFound("Payslip not found");
  const lines = await query(
    `SELECT name, type, amount FROM payslip_lines WHERE payslip_id = $1 AND institution_id = $2 ORDER BY type DESC, name`,
    [id, institutionId]
  );
  return {
    id: p.id,
    teacherId: p.teacher_id,
    teacherName: `${p.first_name} ${p.last_name}`,
    employeeNo: p.employee_no,
    month: p.month,
    workingDays: p.working_days,
    presentDays: p.present_days,
    absentDays: p.absent_days,
    paidLeave: p.paid_leave,
    unpaidLeave: p.unpaid_leave,
    halfDays: p.half_days,
    gross: Number(p.gross),
    deductions: Number(p.deductions),
    net: Number(p.net),
    status: p.status,
    lines: lines.rows,
  };
}

/** Owner-scoped payslip PDF: staff get their own; admin/accountant get any. */
export async function payslipBuffer(
  req: Request,
  payslipId: string,
  institutionId: string
): Promise<Buffer> {
  const p = await loadPayslip(payslipId, institutionId);
  if (!p) throw ApiError.notFound("Payslip not found");

  const role = req.user!.role;
  const privileged = role === "admin" || role === "accountant" || role === "super_admin";
  if (!privileged) {
    const own = await teacherIdForUser(req.user!.id, institutionId);
    if (!own || own !== p.teacher_id) throw ApiError.forbidden();
  }

  const lines = await query<{ name: string; type: string; amount: string }>(
    `SELECT name, type, amount FROM payslip_lines WHERE payslip_id = $1 AND institution_id = $2 ORDER BY type DESC, name`,
    [payslipId, institutionId]
  );
  return payslipPdf({
    institutionName: p.institution_name,
    logo: await getImage("institution", institutionId, "logo", institutionId),
    staffName: `${p.first_name} ${p.last_name}`,
    employeeNo: p.employee_no,
    month: new Date(p.month).toISOString().slice(0, 7),
    earnings: lines.rows.filter((l) => l.type === "earning").map((l) => ({ name: l.name, amount: Number(l.amount) })),
    deductions: lines.rows.filter((l) => l.type === "deduction").map((l) => ({ name: l.name, amount: Number(l.amount) })),
    attendance: {
      workingDays: p.working_days,
      presentDays: p.present_days,
      absentDays: p.absent_days,
      paidLeave: p.paid_leave,
      unpaidLeave: p.unpaid_leave,
      halfDays: p.half_days,
    },
    gross: Number(p.gross),
    totalDeductions: Number(p.deductions),
    net: Number(p.net),
  });
}
