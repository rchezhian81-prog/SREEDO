import { renderPdf } from "../../utils/pdf";
import type { Col } from "./reportcenter.service";

/** Generic printable table PDF (A4 landscape) used by every report's export. */
export function tablePdf(
  title: string,
  columns: Col[],
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  return renderPdf({ size: "A4", layout: "landscape", margin: 30 }, (doc) => {
    const left = 30;
    const width = doc.page.width - 60;
    const colW = width / Math.max(1, columns.length);

    doc.font("Helvetica-Bold").fontSize(16).text(title, left, 30);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666")
      .text(
        `Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} rows`,
        left,
        50
      );
    doc.fillColor("#000");

    let y = 70;
    const header = () => {
      doc.rect(left, y - 2, width, 15).fill("#eef2f7");
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(8);
      columns.forEach((c, i) =>
        doc.text(c.label, left + i * colW + 2, y, {
          width: colW - 4,
          ellipsis: true,
          lineBreak: false,
        })
      );
      y += 15;
      doc.moveTo(left, y).lineTo(left + width, y).stroke();
      y += 3;
      doc.font("Helvetica").fontSize(8);
    };
    header();

    for (const row of rows) {
      if (y > doc.page.height - 30) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
        y = 30;
        header();
      }
      columns.forEach((c, i) => {
        const v = row[c.key];
        doc.text(v == null ? "" : String(v), left + i * colW + 2, y, {
          width: colW - 4,
          ellipsis: true,
          lineBreak: false,
        });
      });
      y += 13;
    }
    if (rows.length === 0) doc.text("No data for the selected filters.", left, y);
  });
}
