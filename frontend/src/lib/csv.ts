// Minimal, dependency-free CSV handling for the bulk-import UI.
// Parser follows RFC-4180 basics: quoted fields, escaped quotes (""), and
// commas/newlines inside quotes.

/** Parse CSV text into an array of row objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((cells) => cells.some((c) => c.trim() !== "")) // skip blank lines
    .map((cells) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (cells[i] ?? "").trim();
      });
      return obj;
    });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Build a downloadable CSV template (header row + one optional sample row). */
export function toCsvTemplate(
  headers: string[],
  sample?: Record<string, string>
): string {
  const headerLine = headers.join(",");
  if (!sample) return `${headerLine}\n`;
  const sampleLine = headers.map((h) => csvCell(sample[h] ?? "")).join(",");
  return `${headerLine}\n${sampleLine}\n`;
}
