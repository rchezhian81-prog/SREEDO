import { existsSync } from "node:fs";
import { renderPdf } from "../../utils/pdf";

export interface InvoicePdfLine {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  amount: string | number;
}

export interface InvoiceCompany {
  name: string;
  address?: string | null;
  email?: string | null;
  gstin?: string | null;
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
  taxPercent: string | number;
  taxAmount: string | number;
  total: string | number;
  notes: string | null;
  taxNotes: string | null;
  lines: InvoicePdfLine[];
  company?: InvoiceCompany;
}

function money(currency: string, value: string | number): string {
  const n = Number(value);
  return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

// A faint diagonal watermark stamp for non-plain states (PAID/VOID/OVERDUE/DRAFT).
const STAMP: Record<string, { label: string; color: string }> = {
  paid: { label: "PAID", color: "#15803d" },
  void: { label: "VOID", color: "#6b7280" },
  overdue: { label: "OVERDUE", color: "#b91c1c" },
  draft: { label: "DRAFT", color: "#b45309" },
};

/** Renders a self-contained invoice PDF (no external template). */
export function invoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const company = data.company ?? { name: "SRE EDU OS" };
  const stampKey = data.isOverdue ? "overdue" : data.status;

  return renderPdf({ size: "A4", margin: 50 }, (doc) => {
    // Diagonal status watermark drawn first so content sits on top of it.
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

    // Optional logo (top-left), guarded — a bad path must never break issuance.
    if (company.logoPath && existsSync(company.logoPath)) {
      try {
        doc.image(company.logoPath, 50, 45, { fit: [150, 50] });
      } catch {
        /* unreadable image — skip silently */
      }
    }

    // Title block (top-right)
    doc.fontSize(22).text("INVOICE", { align: "right" });
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(data.number ?? "(draft — not yet issued)", { align: "right" })
      .text(`Status: ${(data.isOverdue ? "OVERDUE" : data.status).toUpperCase()}`, {
        align: "right",
      })
      .fillColor("#000");

    doc.moveDown(1.5);

    // From (operator / seller)
    doc.font("Helvetica-Bold").fontSize(11).text(company.name, 50);
    doc.font("Helvetica").fontSize(9).fillColor("#555");
    if (company.address) doc.text(company.address, { width: 260 });
    if (company.email) doc.text(company.email);
    if (company.gstin) doc.text(`GSTIN: ${company.gstin}`);
    doc.fillColor("#000");

    doc.moveDown(1);

    // Bill-to
    doc.font("Helvetica-Bold").fontSize(10).text("BILL TO");
    doc.font("Helvetica").fontSize(12).text(data.billingName || data.institutionName);
    if (data.billingAddress) doc.fontSize(10).fillColor("#555").text(data.billingAddress, { width: 260 }).fillColor("#000");
    if (data.gstin) doc.fontSize(10).fillColor("#555").text(`GSTIN: ${data.gstin}`).fillColor("#000");

    doc.moveDown(1);
    const meta: string[] = [];
    if (data.issuedAt) meta.push(`Issue date: ${data.issuedAt.slice(0, 10)}`);
    if (data.dueDate) meta.push(`Due date: ${data.dueDate}`);
    if (data.periodStart || data.periodEnd)
      meta.push(`Period: ${data.periodStart ?? "?"} → ${data.periodEnd ?? "?"}`);
    if (meta.length)
      doc.fontSize(10).fillColor("#555").text(meta.join("    ")).fillColor("#000");

    doc.moveDown(1.5);

    // Line items
    const headerY = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Description", 50, headerY, { width: 250, continued: true });
    doc.text("Qty", 300, headerY, { width: 60, continued: true });
    doc.text("Unit", 360, headerY, { width: 90, continued: true });
    doc.text("Amount", 450, headerY, { width: 95, align: "right" });
    doc.font("Helvetica");
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    doc.moveDown(0.5);

    for (const line of data.lines) {
      const y = doc.y;
      doc.fontSize(10).text(line.description, 50, y, { width: 250, continued: true });
      doc.text(String(Number(line.quantity)), 300, y, { width: 60, continued: true });
      doc.text(money(data.currency, line.unitPrice), 360, y, { width: 90, continued: true });
      doc.text(money(data.currency, line.amount), 450, y, { width: 95, align: "right" });
    }
    if (data.lines.length === 0) {
      doc.fontSize(10).fillColor("#999").text("(no line items)", 50).fillColor("#000");
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
    totalsRow("Subtotal", money(data.currency, data.subtotal));
    totalsRow(`Tax (${Number(data.taxPercent).toFixed(2)}%)`, money(data.currency, data.taxAmount));
    totalsRow("Total", money(data.currency, data.total), true);

    // Payment details (offline, single payment).
    if (data.status === "paid" && data.paidAt) {
      doc.moveDown(1.2);
      const parts = [`Paid on ${data.paidAt.slice(0, 10)}`];
      if (data.paymentMethod) parts.push(`via ${data.paymentMethod}`);
      if (data.paymentReference) parts.push(`ref ${data.paymentReference}`);
      doc.fontSize(10).fillColor("#15803d").text(parts.join("  ·  "), 50).fillColor("#000");
    }

    if (data.taxNotes) {
      doc.moveDown(1.2).fontSize(9).fillColor("#555").text(data.taxNotes, 50).fillColor("#000");
    }
    if (data.notes) {
      doc.moveDown(0.8).fontSize(10).text(`Notes: ${data.notes}`, 50);
    }
  });
}
