// Presentation surface for the Help / SOP / Documentation / Module Status
// Center (Super Admin Q): module-status / severity / limitation-status / review
// → Badge tone, the enum registries + human labels, the shared date formatter
// and the reason-gated download helper (its own copy — each console keeps one).
// No JSX, so every tab component can import these.

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { IconName } from "@/components/icons";
import type {
  HelpDocReviewStatus,
  HelpDocType,
  HelpLimitationStatus,
  HelpModuleStatus,
  HelpSeverity,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- module status → tone / label -----------------------------------------

export function moduleStatusTone(status: HelpModuleStatus | string | null | undefined): Tone {
  switch (status) {
    case "complete":
    case "production_stable":
      return "green";
    case "in_progress":
      return "amber";
    case "deprecated":
      return "red";
    case "planned":
    default:
      return "slate";
  }
}

const MODULE_STATUS_LABELS: Record<string, string> = {
  complete: "Complete",
  production_stable: "Production stable",
  in_progress: "In progress",
  planned: "Planned",
  deprecated: "Deprecated",
};

export function moduleStatusLabel(status: string | null | undefined): string {
  return (status && MODULE_STATUS_LABELS[status]) || humanizeToken(status);
}

export const MODULE_STATUSES: HelpModuleStatus[] = [
  "complete",
  "production_stable",
  "in_progress",
  "planned",
  "deprecated",
];

// ---- severity → tone -------------------------------------------------------

export function severityTone(severity: HelpSeverity | string | null | undefined): Tone {
  switch (severity) {
    case "critical":
      return "red";
    case "high":
      return "amber";
    case "medium":
      return "blue";
    case "low":
    default:
      return "slate";
  }
}

export const SEVERITIES: HelpSeverity[] = ["low", "medium", "high", "critical"];

// ---- limitation status → tone ----------------------------------------------

export function limitationStatusTone(
  status: HelpLimitationStatus | string | null | undefined
): Tone {
  switch (status) {
    case "fixed":
      return "green";
    case "planned":
      return "blue";
    case "deferred":
      return "amber";
    case "accepted":
    case "future":
    default:
      return "slate";
  }
}

export const LIMITATION_STATUSES: HelpLimitationStatus[] = [
  "accepted",
  "planned",
  "fixed",
  "deferred",
  "future",
];

// ---- doc review status → tone ----------------------------------------------

export function reviewStatusTone(status: HelpDocReviewStatus | string | null | undefined): Tone {
  switch (status) {
    case "reviewed":
      return "green";
    case "needs_review":
      return "amber";
    case "deprecated":
      return "red";
    case "draft":
    default:
      return "slate";
  }
}

// ---- search / content type registry ----------------------------------------

export const CONTENT_TYPE_META: Record<HelpDocType, { label: string; icon: IconName }> = {
  help: { label: "Help article", icon: "bookOpen" },
  sop: { label: "SOP", icon: "clipboard" },
  checklist: { label: "Checklist", icon: "check" },
  playbook: { label: "Playbook", icon: "shieldAlert" },
  release: { label: "Release note", icon: "history" },
  limitation: { label: "Limitation", icon: "alert" },
};

export function contentTypeMeta(type: string): { label: string; icon: IconName } {
  return CONTENT_TYPE_META[type as HelpDocType] ?? { label: humanizeToken(type), icon: "file" };
}

// ---- labels ----------------------------------------------------------------

/** Humanise a snake_case / lowercase token, capitalising the first word. */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ---- formatters ------------------------------------------------------------

/** ISO timestamp → locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** ISO date → locale date (no time), or "—" when absent/invalid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** A nullable reference (PR number, commit, deploy) rendered as text or "—". */
export function refOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

// ---- reason-gated file download (help export) ------------------------------
// This console's own copy of the sanctioned `fetch` exception — mirrors the
// observability / jobs `downloadFile` idiom. Streams the masked CSV/JSON
// snapshot with the stored access token, then triggers a browser save. Throws
// ApiError on a non-OK response so callers can surface a toast.

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
