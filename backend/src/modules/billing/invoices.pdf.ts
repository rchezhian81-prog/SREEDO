import { renderPdf } from "../../utils/pdf";

export interface InvoicePdfLine {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  amount: string | number;
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
  issuedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  subtotal: string | number;
  taxPercent: string | number;
  taxAmount: string | number;
  total: string | number;
  notes: string | null;
  taxNotes: string | null;
  lines: InvoicePdfLine[];
}

function money(currency: string, value: string | number): string {
  const n = Number(value);
  return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

/** Renders a simple, self-contained invoice PDF (no external template). */
export function invoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderPdf({ size: "A4", margin: 50 }, (doc) => {
    // Header
    doc.fontSize(20).text("INVOICE", { align: "right" });
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(data.number ?? "(draft — not yet issued)", { align: "right" })
      .text(`Status: ${data.status.toUpperCase()}`, { align: "right" })
      .fillColor("#000");

    doc.moveDown(2);

    // Bill-to
    doc.fontSize(11).text("Bill to:", { continued: false });
    doc.fontSize(12).text(data.billingName || data.institutionName);
    if (data.billingAddress) doc.fontSize(10).text(data.billingAddress);
    if (data.gstin) doc.fontSize(10).text(`GSTIN: ${data.gstin}`);

    doc.moveDown(1);
    const meta: string[] = [];
    if (data.issuedAt) meta.push(`Issue date: ${data.issuedAt.slice(0, 10)}`);
    if (data.periodStart || data.periodEnd)
      meta.push(`Period: ${data.periodStart ?? "?"} → ${data.periodEnd ?? "?"}`);
    if (data.status === "paid" && data.paidAt)
      meta.push(
        `Paid: ${data.paidAt.slice(0, 10)}${data.paymentMethod ? ` (${data.paymentMethod})` : ""}`
      );
    if (meta.length) doc.fontSize(10).fillColor("#555").text(meta.join("   ")).fillColor("#000");

    doc.moveDown(1.5);

    // Line items
    doc.fontSize(11).text("Description", 50, doc.y, { width: 250, continued: true });
    doc.text("Qty", 300, doc.y, { width: 60, continued: true });
    doc.text("Unit", 360, doc.y, { width: 90, continued: true });
    doc.text("Amount", 450, doc.y, { width: 95, align: "right" });
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke();
    doc.moveDown(0.5);

    for (const line of data.lines) {
      const y = doc.y;
      doc.fontSize(10).text(line.description, 50, y, { width: 250, continued: true });
      doc.text(String(line.quantity), 300, y, { width: 60, continued: true });
      doc.text(money(data.currency, line.unitPrice), 360, y, { width: 90, continued: true });
      doc.text(money(data.currency, line.amount), 450, y, { width: 95, align: "right" });
    }

    doc.moveDown(1);
    doc.moveTo(330, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    const totalsRow = (label: string, value: string) => {
      const y = doc.y;
      doc.fontSize(10).text(label, 330, y, { width: 120, continued: true });
      doc.text(value, 450, y, { width: 95, align: "right" });
    };
    totalsRow("Subtotal", money(data.currency, data.subtotal));
    totalsRow(`Tax (${Number(data.taxPercent).toFixed(2)}%)`, money(data.currency, data.taxAmount));
    doc.fontSize(12);
    totalsRow("Total", money(data.currency, data.total));

    if (data.taxNotes) {
      doc.moveDown(1.5).fontSize(9).fillColor("#555").text(data.taxNotes).fillColor("#000");
    }
    if (data.notes) {
      doc.moveDown(1).fontSize(10).text(`Notes: ${data.notes}`);
    }
  });
}
