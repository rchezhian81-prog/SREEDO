import { existsSync } from "node:fs";
import { renderPdf } from "../../utils/pdf";

export interface InvoicePdfLine {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  sacCode?: string | null;
  amount: string | number;
}

export interface InvoiceCompany {
  name: string;
  tradeName?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  stateCode?: string | null;
  bankDetails?: string | null;
  upiId?: string | null;
  signatoryName?: string | null;
  footer?: string | null;
  terms?: string | null;
  logoPath?: string | null;
}

export interface InvoicePdfData {
  number: string | null;
  status: string;
  currency: string;
  institutionName: string;
  billingName: string | null;
  billingAddress: string | null;
  gstin: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  isOverdue?: boolean;
  issuedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  subtotal: string | number;
  discountAmount?: string | number;
  couponCode?: string | null;
  taxPercent: string | number;
  taxAmount: string | number;
  cgstRate?: string | number;
  cgstAmount?: string | number;
  sgstRate?: string | number;
  sgstAmount?: string | number;
  igstRate?: string | number;
  igstAmount?: string | number;
  roundOff?: string | number;
  total: string | number;
  sacCode?: string | null;
  placeOfSupply?: string | null;
  reverseCharge?: boolean;
  recipientState?: string | null;
  recipientStateCode?: string | null;
  notes: string | null;
  taxNotes: string | null;
  lines: InvoicePdfLine[];
  company?: InvoiceCompany;
}

export function money(currency: string, value: string | number): string {
  const n = Number(value);
  return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}

// Indian numbering system (crore/lakh/thousand/hundred).
function wordsIndian(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  n %= 100;
  if (crore) parts.push(below100(crore) + " Crore");
  if (lakh) parts.push(below100(lakh) + " Lakh");
  if (thousand) parts.push(below100(thousand) + " Thousand");
  if (hundred) parts.push(ONES[hundred] + " Hundred");
  if (n) parts.push(below100(n));
  return parts.join(" ");
}

const FRACTION_LABEL: Record<string, [string, string]> = {
  INR: ["Rupees", "Paise"],
  USD: ["Dollars", "Cents"],
  EUR: ["Euros", "Cents"],
  GBP: ["Pounds", "Pence"],
};

export function amountInWords(value: string | number, currency: string): string {
  const n = Number(value) || 0;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);
  const [major, minor] = FRACTION_LABEL[currency.toUpperCase()] ?? [currency.toUpperCase(), "Cents"];
  let s = `${wordsIndian(whole)} ${major}`;
  if (frac > 0) s += ` and ${below100(frac)} ${minor}`;
  return s + " Only";
}

const STAMP: Record<string, { label: string; color: string }> = {
  paid: { label: "PAID", color: "#15803d" },
  void: { label: "VOID", color: "#6b7280" },
  overdue: { label: "OVERDUE", color: "#b91c1c" },
  draft: { label: "DRAFT", color: "#b45309" },
};

/** Renders a self-contained, GST-ready invoice PDF (no external template). */
export function invoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const c = data.company ?? { name: "SRE EDU OS" };
  const cur = data.currency;
  const stampKey = data.isOverdue ? "overdue" : data.status;
  const title = c.gstin ? "TAX INVOICE" : "INVOICE";

  return renderPdf({ size: "A4", margin: 50, bufferPages: true }, (doc) => {
    // Diagonal status watermark behind the content.
    const stamp = STAMP[stampKey];
    if (stamp) {
      const x0 = doc.x;
      const y0 = doc.y;
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc
        .fontSize(96)
        .fillColor(stamp.color)
        .opacity(0.08)
        .text(stamp.label, 0, doc.page.height / 2 - 60, {
          width: doc.page.width,
          align: "center",
        });
      doc.opacity(1).restore();
      doc.fillColor("#000").fontSize(12);
      doc.x = x0;
      doc.y = y0;
    }

    // Optional logo (top-left), guarded.
    if (c.logoPath && existsSync(c.logoPath)) {
      try {
        doc.image(c.logoPath, 50, 45, { fit: [150, 50] });
      } catch {
        /* unreadable image — skip */
      }
    }

    // Title block (top-right)
    doc.fontSize(22).text(title, { align: "right" });
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(data.number ?? "(draft — not yet issued)", { align: "right" })
      .text(`Status: ${(data.isOverdue ? "OVERDUE" : data.status).toUpperCase()}`, {
        align: "right",
      })
      .fillColor("#000");

    doc.moveDown(1.5);

    // Supplier (from)
    doc.font("Helvetica-Bold").fontSize(12).text(c.name, 50);
    doc.font("Helvetica").fontSize(9).fillColor("#555");
    if (c.tradeName) doc.text(c.tradeName);
    if (c.address) doc.text(c.address, { width: 280 });
    const sLine = [
      c.gstin ? `GSTIN: ${c.gstin}` : null,
      c.pan ? `PAN: ${c.pan}` : null,
    ].filter(Boolean).join("    ");
    if (sLine) doc.text(sLine);
    if (c.state) doc.text(`State: ${c.state}${c.stateCode ? ` (${c.stateCode})` : ""}`);
    const sContact = [c.email, c.phone].filter(Boolean).join("    ");
    if (sContact) doc.text(sContact);
    doc.fillColor("#000");

    doc.moveDown(1);

    // Bill-to
    doc.font("Helvetica-Bold").fontSize(10).text("BILL TO");
    doc.font("Helvetica").fontSize(12).text(data.billingName || data.institutionName);
    doc.fontSize(10).fillColor("#555");
    if (data.billingAddress) doc.text(data.billingAddress, { width: 280 });
    if (data.gstin) doc.text(`GSTIN: ${data.gstin}`);
    if (data.recipientState)
      doc.text(`State: ${data.recipientState}${data.recipientStateCode ? ` (${data.recipientStateCode})` : ""}`);
    doc.fillColor("#000");

    doc.moveDown(1);
    const meta: string[] = [];
    if (data.issuedAt) meta.push(`Issue date: ${data.issuedAt.slice(0, 10)}`);
    if (data.dueDate) meta.push(`Due date: ${data.dueDate}`);
    if (data.periodStart || data.periodEnd)
      meta.push(`Period: ${data.periodStart ?? "?"} → ${data.periodEnd ?? "?"}`);
    if (data.placeOfSupply) meta.push(`Place of supply: ${data.placeOfSupply}`);
    meta.push(`Reverse charge: ${data.reverseCharge ? "Yes" : "No"}`);
    doc.fontSize(9).fillColor("#555").text(meta.join("    "), { width: 495 }).fillColor("#000");

    doc.moveDown(1.2);

    // Line items header
    const hy = doc.y;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Description", 50, hy, { width: 195, continued: true });
    doc.text("SAC/HSN", 248, hy, { width: 60, continued: true });
    doc.text("Qty", 310, hy, { width: 40, continued: true });
    doc.text("Unit", 358, hy, { width: 90, continued: true });
    doc.text("Amount", 450, hy, { width: 95, align: "right" });
    doc.font("Helvetica");
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    doc.moveDown(0.5);

    for (const line of data.lines) {
      const y = doc.y;
      doc.fontSize(9).text(line.description, 50, y, { width: 195, continued: true });
      doc.text(line.sacCode || data.sacCode || "-", 248, y, { width: 60, continued: true });
      doc.text(String(Number(line.quantity)), 310, y, { width: 40, continued: true });
      doc.text(money(cur, line.unitPrice), 358, y, { width: 90, continued: true });
      doc.text(money(cur, line.amount), 450, y, { width: 95, align: "right" });
    }
    if (data.lines.length === 0) {
      doc.fontSize(9).fillColor("#999").text("(no line items)", 50).fillColor("#000");
    }

    doc.moveDown(1);
    doc.moveTo(330, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    const totalsRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      doc.fontSize(bold ? 12 : 10).text(label, 330, y, { width: 120, continued: true });
      doc.text(value, 450, y, { width: 95, align: "right" });
      doc.font("Helvetica");
    };
    totalsRow("Subtotal", money(cur, data.subtotal));
    if (Number(data.discountAmount) > 0)
      totalsRow(`Discount${data.couponCode ? ` (${data.couponCode})` : ""}`, `- ${money(cur, data.discountAmount ?? 0)}`);
    const cg = Number(data.cgstAmount ?? 0), sg = Number(data.sgstAmount ?? 0), ig = Number(data.igstAmount ?? 0);
    const rcm = data.reverseCharge ? " (RCM)" : "";
    if (cg > 0 || sg > 0) {
      totalsRow(`CGST (${Number(data.cgstRate ?? 0).toFixed(2)}%)${rcm}`, money(cur, data.cgstAmount ?? 0));
      totalsRow(`SGST (${Number(data.sgstRate ?? 0).toFixed(2)}%)${rcm}`, money(cur, data.sgstAmount ?? 0));
    } else if (ig > 0) {
      totalsRow(`IGST (${Number(data.igstRate ?? 0).toFixed(2)}%)${rcm}`, money(cur, data.igstAmount ?? 0));
    } else {
      totalsRow(`Tax (${Number(data.taxPercent).toFixed(2)}%)`, money(cur, data.taxAmount));
    }
    if (Number(data.roundOff) !== 0) totalsRow("Round off", money(cur, data.roundOff ?? 0));
    totalsRow("Total", money(cur, data.total), true);
    if (data.reverseCharge)
      doc.moveDown(0.3).fontSize(8).fillColor("#a00").text("Tax payable by recipient under reverse charge (RCM)", 330, doc.y, { width: 215 }).fillColor("#000");

    // Amount in words
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor("#333").text(`Amount in words: ${amountInWords(data.total, cur)}`, 50, doc.y, { width: 495 }).fillColor("#000");

    // Payment / bank block
    if (data.status === "paid" && data.paidAt) {
      doc.moveDown(0.8);
      const parts = [`Paid on ${data.paidAt.slice(0, 10)}`];
      if (data.paymentMethod) parts.push(`via ${data.paymentMethod}`);
      if (data.paymentReference) parts.push(`ref ${data.paymentReference}`);
      doc.fontSize(10).fillColor("#15803d").text(parts.join("  ·  "), 50).fillColor("#000");
    } else if (c.bankDetails || c.upiId) {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(9).text("Payment details", 50);
      doc.font("Helvetica").fontSize(9).fillColor("#555");
      if (c.bankDetails) doc.text(c.bankDetails, { width: 350 });
      if (c.upiId) doc.text(`UPI: ${c.upiId}`);
      doc.fillColor("#000");
    }

    if (data.taxNotes) {
      doc.moveDown(0.8).fontSize(9).fillColor("#555").text(data.taxNotes, 50, doc.y, { width: 495 }).fillColor("#000");
    }
    if (data.notes) {
      doc.moveDown(0.6).fontSize(9).text(`Notes: ${data.notes}`, 50, doc.y, { width: 495 });
    }
    if (c.terms) {
      doc.moveDown(0.6).fontSize(8).fillColor("#777").text(`Terms: ${c.terms}`, 50, doc.y, { width: 495 }).fillColor("#000");
    }

    // Signatory
    doc.moveDown(1.5);
    doc.fontSize(9).text(`For ${c.name}`, 380, doc.y, { width: 165, align: "right" });
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#555")
      .text(c.signatoryName ? `${c.signatoryName} — Authorized Signatory` : "Authorized Signatory", 330, doc.y, { width: 215, align: "right" })
      .fillColor("#000");

    // Footer + page numbers on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footer = [c.footer, c.email ? `Support: ${c.email}` : null]
        .filter(Boolean)
        .join("  ·  ");
      doc
        .fontSize(8)
        .fillColor("#999")
        .text(
          `${footer ? footer + "  ·  " : ""}Page ${i + 1} of ${range.count}`,
          50,
          doc.page.height - 40,
          { width: 495, align: "center", lineBreak: false }
        )
        .fillColor("#000");
    }
  });
}
