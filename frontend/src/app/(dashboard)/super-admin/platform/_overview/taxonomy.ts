// Presentation surface for the Platform Overview command center (Super Admin E):
// window presets, status/severity → Badge tone, the cross-module + trend
// registries and the shared date formatter + token-gated download helper. No JSX,
// so every section component can import these. Number / byte formatting lives in
// the shared platform `_utils`.

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { IconName } from "@/components/icons";
import type {
  OverviewCardStatus,
  OverviewSeverity,
  OverviewWindow,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- window presets --------------------------------------------------------

export const OVERVIEW_WINDOWS: { value: OverviewWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export function windowLabel(w: OverviewWindow): string {
  return OVERVIEW_WINDOWS.find((x) => x.value === w)?.label ?? String(w);
}

// ---- status / severity → tone ---------------------------------------------

/** Cross-module card status → tone (healthy→green, warning→amber, critical→red, unknown→slate). */
export function statusTone(status: OverviewCardStatus | string | null | undefined): Tone {
  switch (status) {
    case "healthy":
      return "green";
    case "warning":
      return "amber";
    case "critical":
      return "red";
    default:
      return "slate";
  }
}

/** Attention severity → tone (critical→red, warning→amber, info→blue). */
export function severityTone(severity: OverviewSeverity | string | null | undefined): Tone {
  switch (severity) {
    case "critical":
      return "red";
    case "warning":
      return "amber";
    case "info":
      return "blue";
    default:
      return "slate";
  }
}

// ---- labels ----------------------------------------------------------------

/** Humanise a snake_case / lowercase token, capitalising the first word. */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word status token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ---- cross-module status card registry (keys mirror service moduleStatus) --

export const MODULE_META: Record<string, { label: string; icon: IconName }> = {
  tenants: { label: "Tenants", icon: "building" },
  subscriptions: { label: "Subscriptions", icon: "card" },
  billing: { label: "Billing & Invoices", icon: "receipt" },
  security: { label: "Security", icon: "shield" },
  observability: { label: "Observability", icon: "health" },
  jobs: { label: "Background Jobs", icon: "layers" },
  backups: { label: "Backups", icon: "database" },
  exports: { label: "Data Exports", icon: "download" },
  communication: { label: "Communication", icon: "mail" },
  support: { label: "Support Access", icon: "lifeBuoy" },
  audit: { label: "Audit Log", icon: "history" },
};

export function moduleMeta(key: string): { label: string; icon: IconName } {
  return MODULE_META[key] ?? { label: humanizeToken(key), icon: "grid" };
}

/** Stable render order for the module cards (present keys only). */
export const MODULE_ORDER: string[] = [
  "tenants",
  "subscriptions",
  "billing",
  "security",
  "audit",
  "support",
  "observability",
  "jobs",
  "backups",
  "exports",
  "communication",
];

// ---- attention source-module registry --------------------------------------

const SOURCE_META: Record<string, { label: string; icon: IconName }> = {
  observability: { label: "Observability", icon: "health" },
  jobs: { label: "Jobs", icon: "layers" },
  backups: { label: "Backups", icon: "database" },
  exports: { label: "Exports", icon: "download" },
  communication: { label: "Communication", icon: "mail" },
  security: { label: "Security", icon: "shield" },
  support: { label: "Support", icon: "lifeBuoy" },
  subscriptions: { label: "Subscriptions", icon: "card" },
  billing: { label: "Billing", icon: "receipt" },
};

export function sourceMeta(key: string): { label: string; icon: IconName } {
  return SOURCE_META[key] ?? { label: humanizeToken(key), icon: "grid" };
}

// ---- trend registry (keys mirror service trends output) --------------------

export type SparkTone = "brand" | "green" | "amber" | "red" | "violet";

export interface TrendMeta {
  label: string;
  icon: IconName;
  /** Optional per-metric-column tone override (else the series tone is used). */
  tones?: Record<string, SparkTone>;
  tone: SparkTone;
}

/** Render order + metadata for each trend series the API may return. */
export const TREND_META: { key: string; meta: TrendMeta }[] = [
  { key: "tenantGrowth", meta: { label: "Tenant growth", icon: "building", tone: "brand" } },
  {
    key: "invoices",
    meta: {
      label: "Invoices paid / unpaid",
      icon: "receipt",
      tone: "green",
      tones: { paid: "green", unpaid: "amber" },
    },
  },
  { key: "failedLogins", meta: { label: "Failed logins", icon: "lock", tone: "red" } },
  { key: "highRiskAudit", meta: { label: "High-risk audit", icon: "shieldAlert", tone: "amber" } },
  { key: "jobFailures", meta: { label: "Job failures", icon: "layers", tone: "red" } },
  { key: "commFailures", meta: { label: "Comm failures", icon: "mail", tone: "red" } },
  {
    key: "backups",
    meta: {
      label: "Backups success / failed",
      icon: "database",
      tone: "green",
      tones: { success: "green", failed: "red" },
    },
  },
  { key: "exportVolume", meta: { label: "Export volume", icon: "download", tone: "brand" } },
];

// ---- formatters ------------------------------------------------------------

/** ISO timestamp → locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** ISO timestamp → relative "3m ago" / "2h ago" / "5d ago", else the locale date. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return formatDateTime(value);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

// ---- token-gated file download (overview export) ---------------------------
// The one sanctioned `fetch` exception — mirrors the observability / jobs
// `downloadFile` idiom. Streams the masked CSV/JSON snapshot with the stored
// access token, then triggers a browser save. Throws ApiError on a non-OK
// response so callers can surface a toast.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") message = d.error;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(res.status, message);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
