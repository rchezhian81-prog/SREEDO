import PDFDocument from "pdfkit";

export interface ReportSubject {
  subjectName: string;
  maxMarks: number;
  marksObtained: number;
  percent: number;
  grade: string;
  remark: string;
}

export interface ReportCardData {
  institutionName: string;
  academicYear: string | null;
  examName: string;
  student: {
    name: string;
    admissionNo: string;
    className: string | null;
    sectionName: string | null;
    gender: string | null;
  };
  subjects: ReportSubject[];
  totals: {
    total: number;
    max: number;
    percentage: number;
    grade: string;
    result: "PASS" | "FAIL";
  };
  attendance: { total: number; present: number; rate: number | null } | null;
}

export interface MarkSheetRow {
  admissionNo: string;
  name: string;
  marks: Record<string, number | null>;
  total: number;
  max: number;
  percentage: number;
  grade: string;
  result: "PASS" | "FAIL";
}

export interface MarkSheetData {
  institutionName: string;
  academicYear: string | null;
  examName: string;
  className: string | null;
  sectionName: string | null;
  subjects: string[];
  rows: MarkSheetRow[];
}

type Build = (doc: PDFKit.PDFDocument) => void;

function renderToBuffer(
  opts: PDFKit.PDFDocumentOptions,
  build: Build
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(opts);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

interface Cell {
  x: number;
  w: number;
  text: string;
  align?: "left" | "center" | "right";
}

function tableRow(
  doc: PDFKit.PDFDocument,
  cells: Cell[],
  y: number,
  bold: boolean
): void {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
  for (const c of cells) {
    doc.text(c.text, c.x + 3, y, {
      width: c.w - 6,
      align: c.align ?? "left",
      lineBreak: false,
      ellipsis: true,
    });
  }
}

function header(
  doc: PDFKit.PDFDocument,
  width: number,
  title: string,
  data: { institutionName: string; academicYear: string | null; examName: string }
): number {
  // Logo placeholder.
  doc.rect(40, 40, 56, 56).stroke();
  doc.fontSize(7).fillColor("#999").text("LOGO", 40, 64, { width: 56, align: "center" });
  doc.fillColor("#000");

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(data.institutionName, 104, 44, { width: width - 64, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(12)
    .text(title, 104, 70, { width: width - 64, align: "center" });
  const meta = [
    data.academicYear ? `Academic Year: ${data.academicYear}` : null,
    `Examination: ${data.examName}`,
  ]
    .filter(Boolean)
    .join("        ");
  doc.fontSize(10).text(meta, 104, 88, { width: width - 64, align: "center" });

  const lineY = 108;
  doc.moveTo(40, lineY).lineTo(40 + width, lineY).stroke();
  return lineY + 12;
}

export function reportCardPdf(data: ReportCardData): Promise<Buffer> {
  return renderToBuffer({ size: "A4", margin: 40 }, (doc) => {
    const left = 40;
    const width = doc.page.width - 80; // 515

    let y = header(doc, width, "REPORT CARD", data);

    // Student details (two columns).
    const s = data.student;
    const detail = (label: string, value: string, x: number, yy: number) => {
      doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, x, yy, {
        continued: true,
      });
      doc.font("Helvetica").text(value || "—");
    };
    const col2 = left + width / 2;
    detail("Name", s.name, left, y);
    detail("Admission No", s.admissionNo, col2, y);
    y += 16;
    detail("Class", `${s.className ?? "—"} ${s.sectionName ?? ""}`.trim(), left, y);
    detail("Gender", s.gender ?? "—", col2, y);
    y += 24;

    // Subject table.
    const cols = {
      subject: { x: left, w: 175 },
      max: { x: left + 175, w: 70 },
      obtained: { x: left + 245, w: 85 },
      grade: { x: left + 330, w: 70 },
      remark: { x: left + 400, w: 115 },
    };
    const headerCells: Cell[] = [
      { ...cols.subject, text: "Subject" },
      { ...cols.max, text: "Max", align: "center" },
      { ...cols.obtained, text: "Obtained", align: "center" },
      { ...cols.grade, text: "Grade", align: "center" },
      { ...cols.remark, text: "Remark" },
    ];
    doc.rect(left, y - 2, width, 16).fill("#f0f0f0");
    doc.fillColor("#000");
    tableRow(doc, headerCells, y, true);
    y += 16;
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 4;

    for (const sub of data.subjects) {
      tableRow(
        doc,
        [
          { ...cols.subject, text: sub.subjectName },
          { ...cols.max, text: String(sub.maxMarks), align: "center" },
          { ...cols.obtained, text: String(sub.marksObtained), align: "center" },
          { ...cols.grade, text: sub.grade, align: "center" },
          { ...cols.remark, text: sub.remark },
        ],
        y,
        false
      );
      y += 16;
    }
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 8;

    // Totals.
    const t = data.totals;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`Total: ${t.total} / ${t.max}`, left, y);
    doc.text(`Percentage: ${t.percentage.toFixed(2)}%`, left + 170, y);
    doc.text(`Grade: ${t.grade}`, left + 330, y);
    doc.text(`Result: ${t.result}`, left + 420, y);
    y += 22;

    if (data.attendance) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Attendance: ${data.attendance.present} / ${data.attendance.total}` +
            (data.attendance.rate != null ? ` (${data.attendance.rate}%)` : ""),
          left,
          y
        );
      y += 22;
    }

    // Signature placeholders.
    const sigY = Math.max(y + 40, doc.page.height - 120);
    const third = width / 3;
    for (const [i, label] of ["Class Teacher", "Principal", "Parent/Guardian"].entries()) {
      const x = left + i * third;
      doc.moveTo(x, sigY).lineTo(x + third - 20, sigY).stroke();
      doc.font("Helvetica").fontSize(9).text(label, x, sigY + 4, {
        width: third - 20,
        align: "center",
      });
    }
  });
}

export function markSheetPdf(data: MarkSheetData): Promise<Buffer> {
  return renderToBuffer({ size: "A4", layout: "landscape", margin: 30 }, (doc) => {
    const left = 30;
    const width = doc.page.width - 60; // ~782

    let y = header(doc, width, "MARK SHEET", data);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        `Class: ${data.className ?? "—"} ${data.sectionName ?? ""}`.trim(),
        left,
        y
      );
    y += 20;

    // Column layout: Adm + Name fixed, subjects share the middle, then totals.
    const admW = 70;
    const nameW = 130;
    const totalW = 50;
    const pctW = 50;
    const gradeW = 45;
    const resultW = 50;
    const fixed = admW + nameW + totalW + pctW + gradeW + resultW;
    const subjW = Math.max(
      40,
      (width - fixed) / Math.max(1, data.subjects.length)
    );

    const buildCells = (
      adm: string,
      name: string,
      perSubject: string[],
      total: string,
      pct: string,
      grade: string,
      result: string
    ): Cell[] => {
      const cells: Cell[] = [
        { x: left, w: admW, text: adm },
        { x: left + admW, w: nameW, text: name },
      ];
      let x = left + admW + nameW;
      for (const v of perSubject) {
        cells.push({ x, w: subjW, text: v, align: "center" });
        x += subjW;
      }
      cells.push({ x, w: totalW, text: total, align: "center" });
      cells.push({ x: x + totalW, w: pctW, text: pct, align: "center" });
      cells.push({ x: x + totalW + pctW, w: gradeW, text: grade, align: "center" });
      cells.push({
        x: x + totalW + pctW + gradeW,
        w: resultW,
        text: result,
        align: "center",
      });
      return cells;
    };

    doc.rect(left, y - 2, width, 16).fill("#f0f0f0");
    doc.fillColor("#000");
    tableRow(
      doc,
      buildCells("Adm No", "Name", data.subjects, "Total", "%", "Grade", "Result"),
      y,
      true
    );
    y += 16;
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 4;

    for (const r of data.rows) {
      if (y > doc.page.height - 50) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
        y = 40;
      }
      tableRow(
        doc,
        buildCells(
          r.admissionNo,
          r.name,
          data.subjects.map((sub) =>
            r.marks[sub] == null ? "-" : String(r.marks[sub])
          ),
          String(r.total),
          r.percentage.toFixed(1),
          r.grade,
          r.result
        ),
        y,
        false
      );
      y += 15;
    }
  });
}
