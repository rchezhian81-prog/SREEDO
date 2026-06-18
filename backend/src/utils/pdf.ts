import PDFDocument from "pdfkit";

export interface PdfImage {
  buffer: Buffer;
  mime: string;
}

type ImagePlacement = {
  width?: number;
  height?: number;
  fit?: [number, number];
  align?: "center" | "right";
  valign?: "center" | "bottom";
};

type Build = (doc: PDFKit.PDFDocument) => void;

/** Builds a PDF in memory and resolves the bytes. */
export function renderPdf(
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

/**
 * Embeds an image if present and PDF-safe (pdfkit supports PNG/JPEG only),
 * swallowing any decode error. Returns true when the image was drawn — callers
 * draw a placeholder when it returns false (graceful logo/photo fallback).
 */
export function tryImage(
  doc: PDFKit.PDFDocument,
  img: PdfImage | null,
  x: number,
  y: number,
  placement: ImagePlacement
): boolean {
  if (!img || !/^image\/(png|jpe?g)$/.test(img.mime)) return false;
  try {
    doc.image(img.buffer, x, y, placement);
    return true;
  } catch {
    return false;
  }
}
