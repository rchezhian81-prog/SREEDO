import type { Request } from "express";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { storage } from "../../utils/storage";
import { accessibleStudentIds, assertStudentAccess } from "../../utils/scope";
import type { PdfImage } from "../../utils/pdf";
import {
  bulkIdCardsPdf,
  idCardPdf,
  receiptPdf,
  type IdCardData,
} from "./pdfs.pdf";

/** Latest matching document fetched as an embeddable image, or null (graceful). */
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
    const buffer = await storage.get(rows[0].storage_key);
    return { buffer, mime: rows[0].mime_type };
  } catch (err) {
    console.error("getImage failed (continuing without it):", err);
    return null;
  }
}

const logoFor = (institutionId: string) =>
  getImage("institution", institutionId, "logo", institutionId);

const shortId = (id: string) => id.replace(/-/g, "").slice(0, 10).toUpperCase();

// --- Fee receipt ---

export async function feeReceiptBuffer(
  req: Request,
  paymentId: string,
  institutionId: string
): Promise<Buffer> {
  const { rows } = await query<{
    amount: string;
    method: string;
    reference: string | null;
    paid_at: Date;
    invoice_no: string;
    description: string;
    amount_due: string;
    amount_paid: string;
    student_id: string;
    first_name: string;
    last_name: string;
    admission_no: string;
    section_name: string | null;
    class_name: string | null;
    institution_name: string;
  }>(
    `SELECT p.amount, p.method, p.reference, p.paid_at,
            i.invoice_no, i.description, i.amount_due, i.amount_paid,
            s.id AS student_id, s.first_name, s.last_name, s.admission_no,
            sec.name AS section_name, c.name AS class_name,
            inst.name AS institution_name
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN students s ON s.id = i.student_id
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     JOIN institutions inst ON inst.id = p.institution_id
     WHERE p.id = $1 AND p.institution_id = $2`,
    [paymentId, institutionId]
  );
  const r = rows[0];
  if (!r) throw ApiError.notFound("Payment not found");

  assertStudentAccess(await accessibleStudentIds(req), r.student_id);

  return receiptPdf({
    institutionName: r.institution_name,
    logo: await logoFor(institutionId),
    receiptNo: `RCPT-${shortId(paymentId)}`,
    date: new Date(r.paid_at).toISOString().slice(0, 10),
    studentName: `${r.first_name} ${r.last_name}`,
    admissionNo: r.admission_no,
    className: r.class_name,
    sectionName: r.section_name,
    invoiceNo: r.invoice_no,
    description: r.description,
    method: r.method,
    reference: r.reference,
    amountPaid: Number(r.amount),
    amountDue: Number(r.amount_due),
    totalPaid: Number(r.amount_paid),
    balance: Number(r.amount_due) - Number(r.amount_paid),
  });
}

// --- Student ID card ---

interface StudentRow {
  first_name: string;
  last_name: string;
  admission_no: string;
  guardian_phone: string | null;
  section_name: string | null;
  class_name: string | null;
  institution_name: string;
}

async function studentCardData(
  studentId: string,
  institutionId: string
): Promise<IdCardData> {
  const { rows } = await query<StudentRow>(
    `SELECT s.first_name, s.last_name, s.admission_no, s.guardian_phone,
            sec.name AS section_name, c.name AS class_name, inst.name AS institution_name
     FROM students s
     LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     JOIN institutions inst ON inst.id = s.institution_id
     WHERE s.id = $1 AND s.institution_id = $2`,
    [studentId, institutionId]
  );
  const s = rows[0];
  if (!s) throw ApiError.notFound("Student not found");
  return {
    institutionName: s.institution_name,
    logo: await logoFor(institutionId),
    photo: await getImage("student", studentId, "profile_photo", institutionId),
    name: `${s.first_name} ${s.last_name}`,
    idLabel: "Admission No",
    idNumber: s.admission_no,
    line1: `${s.class_name ?? "—"} ${s.section_name ?? ""}`.trim(),
    bloodGroup: "—",
    contact: s.guardian_phone ?? "",
    validity: String(new Date().getFullYear()),
  };
}

export async function studentIdCardBuffer(
  req: Request,
  studentId: string,
  institutionId: string
): Promise<Buffer> {
  assertStudentAccess(await accessibleStudentIds(req), studentId);
  return idCardPdf(await studentCardData(studentId, institutionId));
}

export async function bulkStudentIdCardsBuffer(
  sectionId: string,
  institutionId: string
): Promise<Buffer> {
  const { rows: sec } = await query(
    "SELECT 1 FROM sections WHERE id = $1 AND institution_id = $2",
    [sectionId, institutionId]
  );
  if (!sec[0]) throw ApiError.notFound("Section not found");
  const { rows: students } = await query<{ id: string }>(
    `SELECT id FROM students
     WHERE institution_id = $1 AND section_id = $2 AND status <> 'archived'
     ORDER BY first_name, last_name`,
    [institutionId, sectionId]
  );
  const cards: IdCardData[] = [];
  for (const s of students) {
    cards.push(await studentCardData(s.id, institutionId));
  }
  return bulkIdCardsPdf(cards);
}

// --- Staff ID card ---

export async function staffIdCardBuffer(
  req: Request,
  userId: string,
  institutionId: string
): Promise<Buffer> {
  const role = req.user!.role;
  if (role === "student" || role === "parent") {
    throw ApiError.forbidden("Staff ID cards are staff-only");
  }
  if (role !== "admin" && userId !== req.user!.id) {
    throw ApiError.forbidden("You can only download your own ID card");
  }
  const { rows } = await query<{
    full_name: string;
    email: string;
    phone: string | null;
    role: string;
    institution_name: string;
  }>(
    `SELECT u.full_name, u.email, u.phone, u.role, inst.name AS institution_name
     FROM users u JOIN institutions inst ON inst.id = u.institution_id
     WHERE u.id = $1 AND u.institution_id = $2`,
    [userId, institutionId]
  );
  const u = rows[0];
  if (!u) throw ApiError.notFound("Staff member not found");

  return idCardPdf({
    institutionName: u.institution_name,
    logo: await logoFor(institutionId),
    photo: await getImage("user", userId, "profile_photo", institutionId),
    name: u.full_name,
    idLabel: "Staff ID",
    idNumber: `STF-${shortId(userId)}`,
    line1: u.role.replace("_", " "),
    bloodGroup: "—",
    contact: u.phone ?? u.email,
    validity: String(new Date().getFullYear()),
  });
}
