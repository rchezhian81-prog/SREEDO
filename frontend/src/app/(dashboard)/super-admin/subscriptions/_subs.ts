// Shared types, constants and helpers for the Super Admin → Subscriptions
// console. Mirrors the fixed backend response shapes documented in
// backend/src/modules/platform/subscriptions.{routes,service,schema}.ts.

import { useAuthStore } from "@/stores/auth-store";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// ---- Filter vocabularies (kept in sync with subscriptions.schema.ts) ----
export const SUB_STATUSES = [
  "active",
  "trialing",
  "suspended",
  "cancelled",
  "expired",
] as const;
export const BILLING_CYCLES = [
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
] as const;
export const INSTITUTION_TYPES = [
  "school",
  "college",
  "university",
  "coaching",
  "other",
] as const;
export const PAYMENT_STATUSES = [
  "paid",
  "outstanding",
  "overdue",
  "none",
] as const;
export const NOTE_TYPES = [
  "renewal",
  "billing",
  "support",
  "cancellation",
  "upgrade",
  "general",
] as const;

export const REPORT_KEYS: { key: string; label: string }[] = [
  { key: "active", label: "Active subscriptions" },
  { key: "trial", label: "Trials" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "suspended", label: "Suspended" },
  { key: "cancelled", label: "Cancelled" },
  { key: "grace", label: "In grace period" },
  { key: "package_wise", label: "Package-wise" },
  { key: "institution_type_wise", label: "Institution-type-wise" },
  { key: "renewal_due", label: "Renewal due" },
  { key: "overdue", label: "Overdue billing" },
  { key: "mrr", label: "MRR (by currency)" },
  { key: "arr", label: "ARR (by currency)" },
  { key: "churn", label: "Churn" },
  { key: "trial_conversion", label: "Trial conversion" },
  { key: "upgrade_downgrade", label: "Upgrades / downgrades" },
];

// ---- Response shapes ----
export interface SubSummary {
  counts: {
    total: number;
    active: number;
    trialing: number;
    suspended: number;
    cancelled: number;
    expired: number;
    expiringSoon: number;
    grace: number;
    overdueBilling: number;
  };
  revenue: {
    mrr: number;
    arr: number;
    currency: string;
    mixedCurrency: boolean;
    outstanding: number;
    overdue: number;
  };
}

export interface SubRow {
  id: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  graceUntil: string | null;
  autoRenew: boolean;
  createdAt: string;
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  institutionType: string;
  institutionActive: boolean;
  packageId: string;
  packageName: string;
  billingCycle: string;
  price: number;
  currency: string;
  outstanding: number;
  overdue: number;
  invoiceCount: number;
  isActiveNow: boolean;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubEvent {
  id: string;
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorEmail: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface SubNote {
  id: string;
  noteType: string;
  body: string;
  followUpDate: string | null;
  owner: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LatestInvoice {
  id: string;
  number: string | null;
  status: string;
  total: number;
  issuedAt: string | null;
  dueDate: string | null;
  isOverdue: boolean;
}

export interface SubDetail extends SubRow {
  maxStudents: number | null;
  maxStaff: number | null;
  packageLimits: Record<string, unknown> | null;
  applicableTypes: string[];
  taxPercent: number | null;
  billing: {
    outstanding: number;
    overdue: number;
    latestInvoice: LatestInvoice | null;
  };
  events: SubEvent[];
  notes: SubNote[];
}

export interface LifecycleConfig {
  trialDays: number;
  graceDays: number;
  renewalReminderDays: number[];
  expiryReminderDays: number[];
  autoExpireEnabled: boolean;
  autoSuspendEnabled: boolean;
  billingOverdueSuspendEnabled: boolean;
  enforce: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
  autoSuspend: boolean;
  reminderDays: number[];
}

export interface LifecyclePreview {
  config: Record<string, unknown>;
  actions: {
    graceStarting: number;
    trialExpiring: number;
    termExpiring: number;
    willExpire: number;
    willAutoSuspend: number;
    remindersToSend: number;
    overdueBillingRisk: number;
  };
  note: string;
}

export interface RunResult {
  graceStarted: number;
  expired: number;
  trialExpired: number;
  autoSuspended: number;
  remindersSent: number;
  ranAt: string;
}

export interface CalendarRow {
  subscriptionId: string;
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  packageName: string;
  status: string;
  kind: string;
  date: string;
}

export interface ReportResult {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown> | null;
}

export interface Reminder {
  id: string;
  kind: string;
  toEmail: string;
  subject: string;
  status: string;
  error: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface SendReminderResult {
  configured: boolean;
  recipients: { to: string; status: string; error?: string }[];
}

export interface PackageBrief {
  id: string;
  name: string;
  billingCycle: string;
  price: number | string;
  currency: string;
  applicableTypes?: string[];
}

// ---- Status badge helper ----
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

/**
 * Map a subscription status (or synthetic state like "grace"/"overdue") to a
 * Badge tone: active→green, trialing→blue, grace/expiring→amber,
 * expired/cancelled→slate, suspended/overdue→red.
 */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "active":
      return "green";
    case "trialing":
      return "blue";
    case "grace":
    case "expiring":
      return "amber";
    case "suspended":
    case "overdue":
      return "red";
    case "expired":
    case "cancelled":
      return "slate";
    default:
      return "slate";
  }
}

/** Human label for a status ("trialing" → "trial"). */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status === "trialing" ? "trial" : status;
}

/** True when a subscription's term has lapsed but it is still within grace. */
export function inGrace(row: {
  status: string;
  graceUntil: string | null;
  endsAt: string | null;
}): boolean {
  if (!row.graceUntil) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  const today = todayISO();
  return (!!row.endsAt && row.endsAt < today) && today <= row.graceUntil;
}

// ---- Date helpers ----
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- Authenticated file download (CSV/XLSX export) ----
export async function downloadExport(
  path: string,
  filename: string
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Pretty-print a cell value for a generic report table. */
export function cellText(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
