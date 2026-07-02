// Shared types, constants and helpers for the Super Admin → Platform Admins
// console. Mirrors the fixed backend response shapes documented in
// backend/src/modules/platform/platform-admins.{routes,service,schema}.ts.

// ---- Platform roles (kept in sync with platform-admins.schema.ts) ----
export const PLATFORM_ROLES = [
  "owner",
  "platform_admin",
  "support_operator",
  "billing_admin",
  "auditor",
  "technical_admin",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  platform_admin: "Platform Admin",
  support_operator: "Support Operator",
  billing_admin: "Billing Admin",
  auditor: "Auditor",
  technical_admin: "Technical Admin",
};

/** Human label for a platform role ("platform_admin" → "Platform Admin"). */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

// ---- Response shapes ----
export interface Admin {
  id: string;
  fullName: string;
  email: string;
  platformRole: string | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  lockedUntil: string | null;
  failedLoginAttempts: number;
  lastLoginAt: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  activeSessions: number;
}

export interface AdminSummary {
  total: number;
  active: number;
  disabled: number;
  locked: number;
  with2fa: number;
  without2fa: number;
  owners: number;
  pendingInvites: number;
}

export type InviteStatus = "pending" | "accepted" | "cancelled" | "expired";

export interface Invite {
  id: string;
  email: string;
  platformRole: string;
  fullName: string | null;
  status: InviteStatus;
  expiresAt: string | null;
  invitedByEmail: string | null;
  acceptedAt: string | null;
  createdAt: string;
  isExpired: boolean;
}

export interface AdminSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface LoginEvent {
  id: string;
  action: string;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  success: boolean;
  createdAt: string;
}

export interface SecurityConfig {
  force2faForPlatform: boolean;
  updatedByEmail: string | null;
  updatedAt: string | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- Badge tone helpers ----
export type Tone = "slate" | "green" | "amber" | "red" | "blue";

/** Owner stands out (brand); every other role reads as neutral. */
export function roleTone(role: string | null | undefined): Tone {
  return role === "owner" ? "blue" : "slate";
}

/**
 * The status chips for an admin. An admin can be both disabled and locked, so we
 * return an array: always an Active/Disabled chip, plus a red Locked chip when
 * the account is currently locked.
 */
export function statusBadges(a: {
  isActive: boolean;
  locked: boolean;
}): { label: string; tone: Tone }[] {
  const out: { label: string; tone: Tone }[] = [
    a.isActive
      ? { label: "Active", tone: "green" }
      : { label: "Disabled", tone: "slate" },
  ];
  if (a.locked) out.push({ label: "Locked", tone: "red" });
  return out;
}

const INVITE_TONE: Record<InviteStatus, Tone> = {
  pending: "amber",
  accepted: "green",
  cancelled: "slate",
  expired: "red",
};

/** Badge tone for an invite lifecycle status. */
export function inviteTone(status: InviteStatus): Tone {
  return INVITE_TONE[status] ?? "slate";
}

// ---- Date helpers ----
/** Render an ISO timestamp as a locale date+time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Condense a raw user-agent string down to something readable in a table. */
export function shortUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
      : /OPR\/|Opera/.test(ua) ? "Opera"
        : /Chrome\//.test(ua) ? "Chrome"
          : /Firefox\//.test(ua) ? "Firefox"
            : /Safari\//.test(ua) ? "Safari"
              : null;
  const os =
    /Windows/.test(ua) ? "Windows"
      : /Mac OS X|Macintosh/.test(ua) ? "macOS"
        : /Android/.test(ua) ? "Android"
          : /iPhone|iPad|iOS/.test(ua) ? "iOS"
            : /Linux/.test(ua) ? "Linux"
              : null;
  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}
