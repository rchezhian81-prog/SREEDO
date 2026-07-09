// PR-T5 — dependency-free CSV parsing for the tenant Import/Export center.
//
// The repo already has a native CSV/XLSX *writer* (src/utils/spreadsheet.ts) but
// no parser, and no CSV/multipart dependency. We accept the raw CSV *text* in a
// JSON body and parse it here, server-side, so validation is authoritative and no
// multipart/parser dependency is introduced.

/** A parsed CSV: the header row and the data rows as objects keyed by header. */
export interface ParsedCsv {
  headers: string[];
  /** One object per data row: { header: cellValue }. Missing cells are "". */
  records: Record<string, string>[];
  /** Raw row count (excluding the header). */
  rowCount: number;
}

/**
 * Parse RFC-4180-ish CSV text into header + record objects. Handles quoted
 * fields, embedded commas/newlines, escaped quotes (""), CRLF/LF, and a leading
 * UTF-8 BOM. Blank lines are skipped. Throws on an empty document or duplicate
 * headers so the caller can surface a clean error.
 */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // Skip fully-blank lines (a single empty field and nothing else).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    started = true;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField();
      pushRow();
    } else if (c === "\r") {
      // swallow; the \n (if any) handles the row break
      if (clean[i + 1] !== "\n") {
        pushField();
        pushRow();
      }
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (file not ending in a newline).
  if (started && (field !== "" || row.length > 0)) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) throw new Error("The file is empty");
  const headers = rows[0].map((h) => h.trim());
  const seen = new Set<string>();
  for (const h of headers) {
    if (!h) throw new Error("A column header is blank");
    if (seen.has(h.toLowerCase())) throw new Error(`Duplicate column header: "${h}"`);
    seen.add(h.toLowerCase());
  }

  const records: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const rec: Record<string, string> = {};
    headers.forEach((h, ci) => {
      rec[h] = (rows[r][ci] ?? "").trim();
    });
    records.push(rec);
  }
  return { headers, records, rowCount: records.length };
}

/**
 * Neutralise CSV/spreadsheet formula-injection. A cell whose text begins with
 * = + - @ (or a leading tab/CR) is treated as a formula by Excel/Sheets; prefix
 * a single quote so it renders as literal text. Applied to every string cell on
 * export. Numbers pass through untouched.
 */
export function sanitizeExportCell<T extends string | number | null | undefined>(v: T): T | string {
  if (typeof v !== "string" || v.length === 0) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
