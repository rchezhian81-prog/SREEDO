import { renderPdf, tryImage, type PdfImage } from "../../utils/pdf";

interface Line {
  name: string;
  amount: number;
}

export interface PayslipData {
  institutionName: string;
  logo: PdfImage | null;
  staffName: string;
  employeeNo: string;
  month: string; // YYYY-MM
  earnings: Line[];
  deductions: Line[];
  attendance: {
    workingDays: number;
    presentDays: number;
    absentDays: number;
    paidLeave: number;
    unpaidLeave: number;
    halfDays: number;
  };
  gross: number;
  totalDeductions: number;
  net: number;
}

export function payslipPdf(data: PayslipData): Promise<Buffer> {
  return renderPdf({ size: "A4", margin: 40 }, (doc) => {
    const left = 40;
    const width = doc.page.width - 80;

    // Header.
    if (!tryImage(doc, data.logo, left, 40, { fit: [56, 56] })) {
      doc.rect(left, 40, 56, 56).stroke();
      doc.fontSize(7).fillColor("#999").text("LOGO", left, 64, { width: 56, align: "center" });
      doc.fillColor("#000");
    }
    doc.font("Helvetica-Bold").fontSize(18).text(data.institutionName, left + 64, 44, {
      width: width - 64,
      align: "center",
    });
    doc.font("Helvetica").fontSize(12).text(`PAYSLIP — ${data.month}`, left + 64, 70, {
      width: width - 64,
      align: "center",
    });
    doc.moveTo(left, 108).lineTo(left + width, 108).stroke();

    let y = 122;
    doc.fontSize(10);
    const kv = (label: string, value: string, x: number, yy: number) => {
      doc.font("Helvetica-Bold").text(`${label}: `, x, yy, { continued: true });
      doc.font("Helvetica").text(value || "—");
    };
    kv("Staff", data.staffName, left, y);
    kv("Employee No", data.employeeNo, left + width / 2, y);
    y += 16;
    const a = data.attendance;
    kv("Working Days", String(a.workingDays), left, y);
    kv("Present", String(a.presentDays), left + width / 2, y);
    y += 16;
    kv("Paid Leave", String(a.paidLeave), left, y);
    kv("Unpaid Leave", String(a.unpaidLeave), left + width / 2, y);
    y += 16;
    kv("Half-days", String(a.halfDays), left, y);
    kv("Absent", String(a.absentDays), left + width / 2, y);
    y += 24;

    // Two-column earnings / deductions tables.
    const colW = width / 2 - 8;
    const earnX = left;
    const dedX = left + width / 2 + 8;
    const headerY = y;
    const tableHead = (label: string, x: number) => {
      doc.rect(x, headerY - 2, colW, 16).fill("#f0f0f0").fillColor("#000");
      doc.font("Helvetica-Bold").fontSize(10).text(label, x + 4, headerY);
      doc.text("Amount", x, headerY, { width: colW - 4, align: "right" });
    };
    tableHead("Earnings", earnX);
    tableHead("Deductions", dedX);
    y = headerY + 18;

    const rows = Math.max(data.earnings.length, data.deductions.length);
    doc.font("Helvetica").fontSize(10);
    for (let i = 0; i < rows; i++) {
      const e = data.earnings[i];
      const d = data.deductions[i];
      if (e) {
        doc.text(e.name, earnX + 4, y, { width: colW - 70 });
        doc.text(e.amount.toFixed(2), earnX, y, { width: colW - 4, align: "right" });
      }
      if (d) {
        doc.text(d.name, dedX + 4, y, { width: colW - 70 });
        doc.text(d.amount.toFixed(2), dedX, y, { width: colW - 4, align: "right" });
      }
      y += 16;
    }
    y += 4;
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 6;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Gross: ${data.gross.toFixed(2)}`, earnX, y, { width: colW, align: "right" });
    doc.text(`Total Deductions: ${data.totalDeductions.toFixed(2)}`, dedX, y, { width: colW, align: "right" });
    y += 22;

    // Net pay band.
    doc.rect(left, y, width, 26).fill("#1e3a8a");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(13)
      .text(`NET PAY: ${data.net.toFixed(2)}`, left, y + 6, { width: width - 10, align: "right" });
    doc.fillColor("#000");

    // Signature placeholder.
    const sigY = doc.page.height - 110;
    doc.moveTo(left + width - 200, sigY).lineTo(left + width, sigY).stroke();
    doc.font("Helvetica").fontSize(9).text("Authorized Signature", left + width - 200, sigY + 4, {
      width: 200,
      align: "center",
    });
  });
}
