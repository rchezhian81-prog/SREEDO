// Shared, presentation-only helpers for the consolidated Audit Console. Mirrors
// the DERIVED severity/result/category taxonomy computed in the backend
// (backend/src/modules/platform/audit.service.ts) so labels and Badge tones stay
// consistent across every section of the console. Pure module — no JSX.

/** Badge tones the shared UI supports (no violet — School uses brand-blue). */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

/** The consolidated filter state shared by the console's controls. */
export interface AuditFilterState {
  q: string;
  institutionId: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  ip: string;
  severity: string;
  result: string;
  category: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: AuditFilterState = {
  q: "",
  institutionId: "",
  actorId: "",
  actorRole: "",
  action: "",
  targetType: "",
  targetId: "",
  ip: "",
  severity: "",
  result: "",
  category: "",
  dateFrom: "",
  dateTo: "",
};

/** Every filter field key — used to seed from a deep-link URL or saved filter. */
export const FILTER_KEYS: (keyof AuditFilterState)[] = [
  "q",
  "institutionId",
  "actorId",
  "actorRole",
  "action",
  "targetType",
  "targetId",
  "ip",
  "severity",
  "result",
  "category",
  "dateFrom",
  "dateTo",
];

/** True when at least one filter field is set. */
export function hasActiveFilters(f: AuditFilterState): boolean {
  return FILTER_KEYS.some((k) => f[k].trim() !== "");
}

/** Coerce an arbitrary saved/URL value bag into a clean, fully-typed filter state. */
export function toFilterState(
  raw: Record<string, unknown> | null | undefined
): AuditFilterState {
  const out: AuditFilterState = { ...EMPTY_FILTERS };
  if (!raw) return out;
  for (const k of FILTER_KEYS) {
    const v = raw[k];
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
  }
  return out;
}

/** Only the non-empty filter fields — what we persist in a saved filter. */
export function compactFilters(f: AuditFilterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = f[k].trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Append the set filter fields to a URLSearchParams (shared by list + export). */
export function appendFilters(p: URLSearchParams, f: AuditFilterState): void {
  for (const [k, v] of Object.entries(compactFilters(f))) p.set(k, v);
}

// ---- severity → tone / label ----
export function severityTone(severity: string | undefined): Tone {
  switch (severity) {
    case "critical":
    case "high_risk":
      return "red";
    case "warning":
      return "amber";
    default:
      return "slate";
  }
}

export function severityLabel(severity: string | undefined): string {
  switch (severity) {
    case "critical":
      return "CRITICAL";
    case "high_risk":
      return "High risk";
    case "warning":
      return "Warning";
    case "info":
      return "Info";
    default:
      return severity || "—";
  }
}

// ---- result → tone / label ----
export function resultTone(result: string | undefined): Tone {
  switch (result) {
    case "success":
      return "green";
    case "failed":
      return "red";
    case "blocked":
      return "amber";
    default:
      return "slate";
  }
}

export function resultLabel(result: string | undefined): string {
  if (!result) return "—";
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Compact, safe stringify of an unknown diff / metadata value for display. */
export function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? '""' : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Humanise a platform role token ("super_admin" → "super admin"). */
export function humanizeRole(role: string | null | undefined): string {
  return role ? role.replace(/_/g, " ") : "—";
}
