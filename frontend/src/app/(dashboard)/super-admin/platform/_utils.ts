/** Shared formatting helpers for the platform console. */

export function formatNumber(value: number | string | null | undefined): string {
  if (value == null || value === "") return "0";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString();
}

/** Human-readable byte size (e.g. 1.4 MB). */
export function formatBytes(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (!n || Number.isNaN(n)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? size : Math.round(size * 10) / 10;
  return `${rounded.toLocaleString()} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export function limitLabel(max: number | null | undefined): string {
  return max == null ? "∞" : max.toLocaleString();
}

/** Compact one-line stringify of an audit `detail` payload. */
export function compactDetail(detail: unknown): string {
  if (detail == null) return "—";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
