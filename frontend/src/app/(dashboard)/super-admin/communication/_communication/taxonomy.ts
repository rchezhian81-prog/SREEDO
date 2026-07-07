// Presentation surface for the Communication Admin console (Super Admin O):
// delivery / template / broadcast / provider status → Badge tone + human labels,
// the enum registries (mirroring the backend commadmin.schema CHECK sets), the
// template variable allowlist + docs, and the shared date/id formatters plus the
// reason-gated download helper. No JSX, so every tab can import these. Number
// formatting lives in the shared platform `_utils`.

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type {
  BroadcastAudience,
  BroadcastChannel,
  BroadcastStatus,
  CommTemplateStatus,
  CommWindow,
  DeliveryStatus,
  PreferenceCategory,
  TemplateCategory,
  TriggerSource,
} from "@/types";

/** Badge tones the shared UI supports. */
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

// ---- delivery status → tone ------------------------------------------------
export function deliveryStatusTone(status: DeliveryStatus | string | null | undefined): Tone {
  switch (status) {
    case "sent":
    case "delivered":
      return "green";
    case "failed":
    case "bounced":
      return "red";
    case "pending":
      return "amber";
    case "skipped":
    default:
      return "slate";
  }
}

// ---- template status → tone ------------------------------------------------
export function templateStatusTone(status: CommTemplateStatus | string | null | undefined): Tone {
  switch (status) {
    case "active":
      return "green";
    case "draft":
      return "amber";
    case "disabled":
    default:
      return "slate";
  }
}

// ---- broadcast status → tone -----------------------------------------------
export function broadcastStatusTone(status: BroadcastStatus | string | null | undefined): Tone {
  switch (status) {
    case "sent":
      return "green";
    case "sending":
      return "blue";
    case "scheduled":
      return "amber";
    case "failed":
      return "red";
    case "cancelled":
    case "draft":
    default:
      return "slate";
  }
}

// ---- provider status → tone ------------------------------------------------
export function providerStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "healthy":
      return "green";
    case "error":
      return "red";
    case "not_configured":
    default:
      return "slate";
  }
}

/** Provider status → human label. */
export function providerStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "error":
      return "Error";
    case "not_configured":
      return "Not configured";
    default:
      return humanizeToken(status);
  }
}

// ---- enum registries (mirror the backend schema) ---------------------------

export const TEMPLATE_STATUSES: CommTemplateStatus[] = ["draft", "active", "disabled"];
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "onboarding",
  "security",
  "billing",
  "subscription",
  "support",
  "backup",
  "export",
  "platform",
  "broadcast",
  "general",
];
export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "pending",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "skipped",
];
export const TRIGGER_SOURCES: TriggerSource[] = [
  "invoice",
  "subscription",
  "support",
  "security",
  "backup",
  "export",
  "platform_admin",
  "manual_test",
  "broadcast",
  "system",
];
export const BROADCAST_AUDIENCES: BroadcastAudience[] = [
  "platform_admins",
  "tenant_admins",
  "specific_tenant",
  "institution_type",
  "all_tenants",
];
export const BROADCAST_CHANNELS: BroadcastChannel[] = ["email", "in_app", "both"];
export const BROADCAST_STATUSES: BroadcastStatus[] = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "cancelled",
];
export const PREFERENCE_CATEGORIES: PreferenceCategory[] = [
  "invoice",
  "subscription",
  "support",
  "security",
  "backup",
  "export",
  "platform_admin",
  "broadcast",
];
export const INSTITUTION_TYPES = ["school", "college"] as const;
export const COMM_WINDOWS: CommWindow[] = ["today", "24h", "7d", "30d", "custom"];

/** Broad audiences require a reason ≥5 + a confirm (mirrors the service isBroad set). */
export const BROAD_AUDIENCES: BroadcastAudience[] = [
  "all_tenants",
  "tenant_admins",
  "institution_type",
];
export function isBroadAudience(audience: string | null | undefined): boolean {
  return !!audience && BROAD_AUDIENCES.includes(audience as BroadcastAudience);
}

/** specific_tenant / institution_type carry an extra filter field. */
export function audienceNeedsInstitution(audience: string | null | undefined): boolean {
  return audience === "specific_tenant";
}
export function audienceNeedsType(audience: string | null | undefined): boolean {
  return audience === "institution_type";
}

// ---- template variable allowlist + docs (mirror commadmin.schema TEMPLATE_VARS) --
export interface TemplateVarDoc {
  name: string;
  doc: string;
}
export const TEMPLATE_VARS: TemplateVarDoc[] = [
  { name: "tenantName", doc: "Institution display name" },
  { name: "tenantCode", doc: "Institution short code" },
  { name: "userName", doc: "Recipient full name" },
  { name: "email", doc: "Recipient email address" },
  { name: "invoiceNumber", doc: "Invoice number" },
  { name: "invoiceAmount", doc: "Invoice amount" },
  { name: "invoiceDueDate", doc: "Invoice due date" },
  { name: "paymentLink", doc: "Payment link (masked in logs)" },
  { name: "subscriptionPackage", doc: "Subscription package name" },
  { name: "subscriptionExpiry", doc: "Subscription expiry date" },
  { name: "supportScope", doc: "Support session scope" },
  { name: "securitySummary", doc: "Security notification summary" },
  { name: "exportName", doc: "Export name" },
  { name: "exportStatus", doc: "Export status" },
  { name: "backupStatus", doc: "Backup status" },
  { name: "platformName", doc: "Platform name" },
  { name: "supportEmail", doc: "Support email address" },
  { name: "appUrl", doc: "Application URL" },
];
export const TEMPLATE_VAR_NAMES: string[] = TEMPLATE_VARS.map((v) => v.name);

// ---- labels ----------------------------------------------------------------

const WINDOW_LABELS: Record<CommWindow, string> = {
  today: "Today",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  custom: "Custom",
};
export function windowLabel(w: CommWindow): string {
  return WINDOW_LABELS[w];
}

const AUDIENCE_LABELS: Record<string, string> = {
  platform_admins: "Platform admins",
  tenant_admins: "Tenant admins",
  specific_tenant: "Specific tenant",
  institution_type: "Institution type",
  all_tenants: "All tenants",
};
export function audienceLabel(audience: string | null | undefined): string {
  return (audience && AUDIENCE_LABELS[audience]) || humanizeToken(audience);
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  in_app: "In-app",
  both: "Email + in-app",
};
export function channelLabel(channel: string | null | undefined): string {
  return (channel && CHANNEL_LABELS[channel]) || humanizeToken(channel);
}

const SOURCE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  subscription: "Subscription",
  support: "Support",
  security: "Security",
  backup: "Backup",
  export: "Export",
  platform_admin: "Platform admin",
  manual_test: "Manual test",
  broadcast: "Broadcast",
  system: "System",
};
export function sourceLabel(source: string | null | undefined): string {
  return (source && SOURCE_LABELS[source]) || humanizeToken(source);
}

const PREFERENCE_LABELS: Record<string, string> = {
  invoice: "Invoice notifications",
  subscription: "Subscription notifications",
  support: "Support notifications",
  security: "Security notifications",
  backup: "Backup notifications",
  export: "Export notifications",
  platform_admin: "Platform-admin notifications",
  broadcast: "Broadcast notifications",
};
export function preferenceLabel(category: string | null | undefined): string {
  return (category && PREFERENCE_LABELS[category]) || humanizeToken(category);
}

// ---- formatters ------------------------------------------------------------

/** Humanise a snake_case token, capitalising the first word. */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/** Capitalise a single-word token. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** ISO timestamp → locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Short 8-char prefix of a UUID for compact display. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** Loose UUID guard so a malformed tenant filter is never sent (backend 400s). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value.trim());
}

/** A recipient counts as a "test" address (no reason needed) when it matches this. */
export function isTestAddress(email: string | null | undefined): boolean {
  return !!email && /(test|example|\+test)/i.test(email);
}

/** File extension for an export format. */
export function formatExt(format: string): string {
  return format === "xlsx" ? "xlsx" : "csv";
}

/** Map a bare backend link to the real super-admin console route. */
export function superAdminHref(backendPath: string | null | undefined): string {
  switch (backendPath) {
    case "/observability/smtp":
    case "/observability":
      return "/super-admin/observability";
    case "/jobs-ops":
    case "/jobs":
      return "/super-admin/jobs";
    case "/platform/security":
      return "/super-admin/security";
    case "/platform/audit":
      return "/super-admin/platform/audit";
    case "/platform/settings":
      return "/super-admin/settings";
    default:
      return `/super-admin${backendPath ?? ""}`;
  }
}

// ---- reason-gated file download (deliveries + reports exports) --------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Reason-gated blob download (the one sanctioned `fetch` exception). Streams the
 * masked CSV/XLSX artifact using the stored access token, then triggers a browser
 * save as `filename`. Throws ApiError on a non-OK response so callers surface it.
 */
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
