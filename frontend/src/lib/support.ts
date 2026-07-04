// Pure, presentation-only helpers for Super Admin G — Support Access. Shared by
// the console (via _support/taxonomy.ts) and the global SupportModeBanner, so the
// status/scope vocabulary and countdown formatting never drift. No JSX.

import type { SupportScope, SupportStatus } from "@/types";

/** Badge tones the shared UI supports (no violet). */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- status → tone / label ----
// active→green, ended→slate, expired→amber, revoked/failed→red.
export function statusTone(status: SupportStatus | string | undefined): Tone {
  switch (status) {
    case "active":
      return "green";
    case "expired":
      return "amber";
    case "revoked":
    case "failed":
      return "red";
    case "ended":
    default:
      return "slate";
  }
}

export function statusLabel(status: string | undefined): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ---- scope → tone / label ----
// read_only→slate, write_enabled→amber, module_limited→blue.
export function scopeTone(scope: SupportScope | string | undefined): Tone {
  switch (scope) {
    case "write_enabled":
      return "amber";
    case "module_limited":
      return "blue";
    case "read_only":
    default:
      return "slate";
  }
}

export function scopeLabel(scope: string | undefined): string {
  switch (scope) {
    case "read_only":
      return "Read-only";
    case "write_enabled":
      return "Write-enabled";
    case "module_limited":
      return "Module-limited";
    default:
      return scope ? humanizeToken(scope) : "—";
  }
}

/** "bug_investigation" → "Bug investigation". */
export function templateLabel(tpl: string | null | undefined): string {
  return tpl ? humanizeToken(tpl) : "—";
}

/** "students" → "Students". */
export function moduleLabel(module: string): string {
  return module.charAt(0).toUpperCase() + module.slice(1);
}

/** Humanise a snake_case token, capitalising the first word. */
export function humanizeToken(token: string): string {
  const s = token.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Humanise a platform role token ("super_admin" → "super admin"). */
export function humanizeRole(role: string | null | undefined): string {
  return role ? role.replace(/_/g, " ") : "—";
}

/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Settled duration in minutes → "45 min" / "1h 5m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * A live countdown from `nowMs` until `expiresMs` as "m:ss" (or "h:mm:ss"), or
 * "Expired" once elapsed. Both inputs are epoch ms.
 */
export function formatCountdown(expiresMs: number, nowMs: number): string {
  const remaining = expiresMs - nowMs;
  if (remaining <= 0) return "Expired";
  const total = Math.floor(remaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
