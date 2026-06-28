import { existsSync } from "node:fs";
import { renderPdf } from "../../utils/pdf";
import { amountInWords, money, type InvoiceCompany } from "./invoices.pdf";

/**
 * Credit / Debit note PDF (Billing P2). A self-contained, GST-ready document
 * that references the original invoice. Reuses the invoice PDF's money/words
 * helpers and the shared InvoiceCompany supplier block for a consistent look.
 */

export interface NotePdfLine {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  sacCode?: string | null;
  amount: string | number;
}

export interface NotePdfData {
  kind: "credit" | "debit";
  number: string | null;
  status: string;
  currency: string;
  institutionName: string;
  // Recipient (billing) details snapshotted from the linked invoice.
  billingName: string | null;
  billingAddress: string | null;
  gstin: string | null;
  recipientState?: string | null;
  recipientStateCode?: string | null;
  // The invoice this note adjusts.
  againstInvoiceNumber: string | null;
  reason: string | null;
  issuedAt: string | null;
  subtotal: string | number;
  taxPercent: string | number;
  taxAmount: string | number;
  roundOff?: string | number;
  total: string | number;
  sacCode?: string | null;
  placeOfSupply?: string | null;
  reverseCharge?: boolean;
  notes: string | null;
  lines: NotePdfLine[];
  company?: InvoiceCompany;
}

const STAMP: Record<string, { label: string; color: string }> = {
  void: { label: "VOID", color: "#6b7280" },
  draft: { label: "DRAFT", color: "#b45309" },
};

/** Renders a self-contained credit/debit note PDF (no external template). */
export function notePdf(data: NotePdfData): Promise<Buffer> {
  const c = data.company ?? { name: "SRE EDU OS" };
  const cur = data.currency;
  const title = data.kind === "credit" ? "CREDIT NOTE" : "DEBIT NOTE";

  return renderPdf({ size: "A4", margin: 50, bufferPages: true }, (doc) => {
    // Diagonal status watermark (draft / void) behind the content.
    const stamp = STAMP[data.status];
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
      .text(`Status: ${data.status.toUpperCase()}`, { align: "right" });
    if (data.againstInvoiceNumber)
      doc.text(`Against invoice: ${data.againstInvoiceNumber}`, { align: "right" });
    doc.fillColor("#000");

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
    if (data.issuedAt) meta.push(`Date: ${data.issuedAt.slice(0, 10)}`);
    if (data.placeOfSupply) meta.push(`Place of supply: ${data.placeOfSupply}`);
    meta.push(`Reverse charge: ${data.reverseCharge ? "Yes" : "No"}`);
    doc.fontSize(9).fillColor("#555").text(meta.join("    "), { width: 495 }).fillColor("#000");

    if (data.reason) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor("#555").text(`Reason: ${data.reason}`, 50, doc.y, { width: 495 }).fillColor("#000");
    }

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
    totalsRow(`Tax (${Number(data.taxPercent).toFixed(2)}%)`, money(cur, data.taxAmount));
    if (Number(data.roundOff) !== 0) totalsRow("Round off", money(cur, data.roundOff ?? 0));
    totalsRow(data.kind === "credit" ? "Credit total" : "Debit total", money(cur, data.total), true);

    // Amount in words
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor("#333").text(`Amount in words: ${amountInWords(data.total, cur)}`, 50, doc.y, { width: 495 }).fillColor("#000");

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
