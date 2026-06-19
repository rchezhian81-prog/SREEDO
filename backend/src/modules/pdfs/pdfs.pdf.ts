import { renderPdf, tryImage, type PdfImage } from "../../utils/pdf";

export interface ReceiptData {
  institutionName: string;
  logo: PdfImage | null;
  receiptNo: string;
  date: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  sectionName: string | null;
  invoiceNo: string;
  description: string;
  method: string;
  reference: string | null;
  amountPaid: number;
  amountDue: number;
  totalPaid: number;
  balance: number;
}

export interface IdCardData {
  institutionName: string;
  logo: PdfImage | null;
  photo: PdfImage | null;
  name: string;
  idLabel: string; // "Admission No" | "Staff ID"
  idNumber: string;
  line1: string; // class/section or designation
  bloodGroup: string;
  contact: string;
  validity: string;
}

export function receiptPdf(data: ReceiptData): Promise<Buffer> {
  return renderPdf({ size: "A4", margin: 40 }, (doc) => {
    const left = 40;
    const width = doc.page.width - 80;

    if (!tryImage(doc, data.logo, left, 40, { fit: [56, 56] })) {
      doc.rect(left, 40, 56, 56).stroke();
      doc.fontSize(7).fillColor("#999").text("LOGO", left, 64, { width: 56, align: "center" });
      doc.fillColor("#000");
    }
    doc.font("Helvetica-Bold").fontSize(18).text(data.institutionName, left + 64, 44, {
      width: width - 64,
      align: "center",
    });
    doc.font("Helvetica").fontSize(12).text("FEE RECEIPT", left + 64, 70, {
      width: width - 64,
      align: "center",
    });
    doc.moveTo(left, 108).lineTo(left + width, 108).stroke();

    let y = 122;
    doc.fontSize(10);
    const row = (label: string, value: string, x: number, yy: number) => {
      doc.font("Helvetica-Bold").text(`${label}: `, x, yy, { continued: true });
      doc.font("Helvetica").text(value || "—");
    };
    row("Receipt No", data.receiptNo, left, y);
    row("Date", data.date, left + width / 2, y);
    y += 16;
    row("Student", data.studentName, left, y);
    row("Admission No", data.admissionNo, left + width / 2, y);
    y += 16;
    row("Class", `${data.className ?? "—"} ${data.sectionName ?? ""}`.trim(), left, y);
    y += 24;

    // Payment details table.
    doc.rect(left, y - 2, width, 16).fill("#f0f0f0").fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(10).text("Description", left + 4, y);
    doc.text("Method", left + width - 200, y, { width: 90 });
    doc.text("Amount", left + width - 100, y, { width: 96, align: "right" });
    y += 18;
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 4;
    doc.font("Helvetica").fontSize(10);
    doc.text(`${data.invoiceNo} — ${data.description}`, left + 4, y, { width: width - 210 });
    doc.text(
      data.method + (data.reference ? ` (${data.reference})` : ""),
      left + width - 200,
      y,
      { width: 90 }
    );
    doc.text(data.amountPaid.toFixed(2), left + width - 100, y, { width: 96, align: "right" });
    y += 28;
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 8;

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Amount Paid: ${data.amountPaid.toFixed(2)}`, left, y);
    doc.text(`Invoice Total: ${data.amountDue.toFixed(2)}`, left + width / 2, y);
    y += 16;
    doc.text(`Total Paid (invoice): ${data.totalPaid.toFixed(2)}`, left, y);
    doc.text(`Balance: ${data.balance.toFixed(2)}`, left + width / 2, y);

    // Signature placeholder.
    const sigY = doc.page.height - 110;
    doc.moveTo(left + width - 200, sigY).lineTo(left + width, sigY).stroke();
    doc.font("Helvetica").fontSize(9).text("Authorized Signature", left + width - 200, sigY + 4, {
      width: 200,
      align: "center",
    });
  });
}

/** Draws one ID card within the given box. */
function drawCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  data: IdCardData
): void {
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).stroke("#334155");
  // Header band.
  doc.rect(x, y, w, 26).fill("#1e3a8a");
  if (tryImage(doc, data.logo, x + 6, y + 4, { fit: [18, 18] })) {
    // logo drawn
  }
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(data.institutionName, x + 28, y + 8, { width: w - 34, ellipsis: true, lineBreak: false });
  doc.fillColor("#000000");

  // Photo box (right).
  const pw = 64;
  const ph = 78;
  const px = x + w - pw - 12;
  const py = y + 36;
  if (!tryImage(doc, data.photo, px, py, { fit: [pw, ph], align: "center", valign: "center" })) {
    doc.rect(px, py, pw, ph).stroke("#94a3b8");
    doc.fontSize(7).fillColor("#94a3b8").text("PHOTO", px, py + ph / 2 - 4, { width: pw, align: "center" });
    doc.fillColor("#000000");
  }

  // Details (left).
  let ty = y + 38;
  const dx = x + 12;
  const dw = w - pw - 36;
  const field = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text(label.toUpperCase(), dx, ty, { width: dw });
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(value || "—", dx, ty + 9, { width: dw, ellipsis: true, lineBreak: false });
    ty += 24;
  };
  field("Name", data.name);
  field(data.idLabel, data.idNumber);
  field("Class / Role", data.line1);
  // Bottom row: blood group + validity.
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("BLOOD", dx, y + h - 30);
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(data.bloodGroup || "—", dx, y + h - 21);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("VALID", dx + 80, y + h - 30);
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(data.validity, dx + 80, y + h - 21);
  doc.font("Helvetica").fontSize(8).fillColor("#475569").text(data.contact || "", dx, y + h - 44, { width: dw, ellipsis: true, lineBreak: false });
  doc.fillColor("#000000");
}

export function idCardPdf(data: IdCardData): Promise<Buffer> {
  return renderPdf({ size: [340, 216], margin: 0 }, (doc) => {
    drawCard(doc, 10, 10, 320, 196, data);
  });
}

export function bulkIdCardsPdf(cards: IdCardData[]): Promise<Buffer> {
  return renderPdf({ size: "A4", margin: 24 }, (doc) => {
    const cardW = 256;
    const cardH = 158;
    const gapX = 18;
    const gapY = 18;
    const left = 24;
    const top = 24;
    const perRow = 2;
    const rowsPerPage = 4;
    cards.forEach((card, i) => {
      const slot = i % (perRow * rowsPerPage);
      if (i > 0 && slot === 0) doc.addPage({ size: "A4", margin: 24 });
      const col = slot % perRow;
      const rowIdx = Math.floor(slot / perRow);
      const x = left + col * (cardW + gapX);
      const y = top + rowIdx * (cardH + gapY);
      drawCard(doc, x, y, cardW, cardH, card);
    });
    if (cards.length === 0) {
      doc.fontSize(12).text("No students to render.", 24, 24);
    }
  });
}

export interface TcData {
  institutionName: string;
  logo: PdfImage | null;
  tcNo: string;
  status: string; // draft | issued | cancelled
  studentName: string;
  admissionNo: string;
  className: string | null;
  sectionName: string | null;
  programName: string | null;
  semesterName: string | null;
  dateOfBirth: string | null;
  guardianName: string | null;
  joiningDate: string | null;
  leavingDate: string | null; // date of issue
  lastAttendanceDate: string | null;
  leavingReason: string | null;
  conduct: string | null;
  academicYear: string | null;
  feeDuesStatus: string | null;
  libraryDuesStatus: string | null;
  transportDuesStatus: string | null;
  hostelDuesStatus: string | null;
  remarks: string | null;
}

export function tcPdf(data: TcData): Promise<Buffer> {
  return renderPdf({ size: "A4", margin: 48 }, (doc) => {
    const left = 48;
    const width = doc.page.width - 96;

    if (!tryImage(doc, data.logo, left, 44, { fit: [54, 54] })) {
      doc.rect(left, 44, 54, 54).stroke();
      doc.fontSize(7).fillColor("#999").text("LOGO", left, 66, { width: 54, align: "center" });
      doc.fillColor("#000");
    }
    doc.font("Helvetica-Bold").fontSize(18).text(data.institutionName, left + 64, 48, {
      width: width - 64,
      align: "center",
    });
    doc.font("Helvetica").fontSize(13).text("TRANSFER CERTIFICATE", left + 64, 74, {
      width: width - 64,
      align: "center",
    });
    doc.moveTo(left, 112).lineTo(left + width, 112).stroke();

    // A cancelled TC is watermarked and must not be treated as valid.
    if (data.status === "cancelled") {
      doc.save();
      doc.fillColor("#cc0000").font("Helvetica-Bold").fontSize(60).opacity(0.25);
      doc.text("CANCELLED", left, 360, { width, align: "center" });
      doc.opacity(1).fillColor("#000").restore();
    }

    let y = 126;
    doc.font("Helvetica").fontSize(10);
    const row = (label: string, value: string | null, x: number, yy: number) => {
      doc.font("Helvetica-Bold").text(`${label}: `, x, yy, { continued: true });
      doc.font("Helvetica").text(value && value.length ? value : "—");
    };
    const half = width / 2;
    row("TC No", data.tcNo, left, y);
    row("Date of Issue", data.leavingDate, left + half, y);
    y += 18;
    row("Student Name", data.studentName, left, y);
    row("Admission No", data.admissionNo, left + half, y);
    y += 18;
    row("Class", `${data.className ?? "—"} ${data.sectionName ?? ""}`.trim(), left, y);
    row("Date of Birth", data.dateOfBirth, left + half, y);
    y += 18;
    if (data.programName || data.semesterName) {
      row("Program", data.programName, left, y);
      row("Semester", data.semesterName, left + half, y);
      y += 18;
    }
    row("Guardian", data.guardianName, left, y);
    row("Academic Year", data.academicYear, left + half, y);
    y += 18;
    row("Date of Joining", data.joiningDate, left, y);
    row("Last Attendance", data.lastAttendanceDate, left + half, y);
    y += 18;
    row("Reason for Leaving", data.leavingReason, left, y);
    y += 18;
    row("Conduct & Character", data.conduct, left, y);
    y += 24;

    doc.font("Helvetica-Bold").fontSize(11).text("Dues status", left, y);
    y += 16;
    doc.fontSize(10);
    row("Fees", data.feeDuesStatus, left, y);
    row("Library", data.libraryDuesStatus, left + half, y);
    y += 18;
    row("Transport", data.transportDuesStatus, left, y);
    row("Hostel", data.hostelDuesStatus, left + half, y);
    y += 24;

    if (data.remarks && data.remarks.length) {
      row("Remarks", data.remarks, left, y);
      y += 24;
    }

    // Signature placeholders.
    const sigY = doc.page.height - 120;
    doc.moveTo(left, sigY).lineTo(left + 180, sigY).stroke();
    doc.font("Helvetica").fontSize(9).text("Class Teacher", left, sigY + 4, { width: 180, align: "center" });
    doc.moveTo(left + width - 180, sigY).lineTo(left + width, sigY).stroke();
    doc.text("Principal / Authorized Signatory", left + width - 180, sigY + 4, {
      width: 180,
      align: "center",
    });
  });
}
