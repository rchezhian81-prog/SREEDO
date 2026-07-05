// Presentation surface for the Backup / Restore / DR console: status → Badge tone
// + label, plus the shared date formatter. No JSX so every console component can
// keep importing these from "./taxonomy". Byte/number formatting lives in the
// shared platform `_utils`.

import type {
  BackupChecksumStatus,
  BackupStatus,
  BackupTrigger,
  OffsiteStatus,
  RestoreRequestStatus,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- backup status → tone / label ----
// success→green, failed→red, running/pending→amber, archived→slate.
export function backupStatusTone(status: BackupStatus | string | undefined): Tone {
  switch (status) {
    case "success":
      return "green";
    case "failed":
      return "red";
    case "pending":
    case "running":
      return "amber";
    case "archived":
    default:
      return "slate";
  }
}

// ---- checksum status → tone / label ----
// verified→green, failed→red, not_verified→slate.
export function checksumTone(status: BackupChecksumStatus | string | null | undefined): Tone {
  switch (status) {
    case "verified":
      return "green";
    case "failed":
      return "red";
    case "not_verified":
    default:
      return "slate";
  }
}

export function checksumLabel(status: BackupChecksumStatus | string | null | undefined): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "failed":
      return "Failed";
    case "not_verified":
      return "Not verified";
    default:
      return "—";
  }
}

// ---- off-site copy → tone / label ----
export function offsiteTone(offsite: boolean): Tone {
  return offsite ? "green" : "slate";
}

export function offsiteLabel(offsite: boolean): string {
  return offsite ? "Off-site" : "Local only";
}

// ---- offsite sync status (settings) → tone / label ----
export function syncStatusTone(status: OffsiteStatus["syncStatus"] | string | undefined): Tone {
  switch (status) {
    case "synced":
      return "green";
    case "failed":
      return "red";
    case "not_configured":
    default:
      return "slate";
  }
}

// ---- restore-request status → tone / label ----
// pending→amber, approved→blue, executed→green, failed→red, rest→slate.
export function restoreStatusTone(status: RestoreRequestStatus | string | undefined): Tone {
  switch (status) {
    case "pending":
      return "amber";
    case "approved":
      return "blue";
    case "executed":
      return "green";
    case "failed":
      return "red";
    case "rejected":
    case "cancelled":
    case "expired":
    default:
      return "slate";
  }
}

/** Humanise a snake_case token, capitalising the first word ("pre_deploy" → "Pre deploy"). */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word status token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Friendly labels for the more technical trigger tokens. */
export function triggerLabel(trigger: BackupTrigger | string | null | undefined): string {
  switch (trigger) {
    case "pre_deploy":
      return "Pre-deploy";
    case "pre_restore":
      return "Pre-restore";
    default:
      return humanizeToken(trigger ?? undefined);
  }
}

/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Short 8-char prefix of a UUID for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
