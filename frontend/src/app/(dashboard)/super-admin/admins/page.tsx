"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { Icon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { usePlatformGuard } from "../platform/_guard";
import { formatNumber } from "../platform/_utils";
import { AdminActionModal, InviteAdminModal, type AdminAction } from "./_modals";
import {
  PLATFORM_ROLES,
  formatDateTime,
  inviteTone,
  roleLabel,
  roleTone,
  statusBadges,
  type Admin,
  type AdminSummary,
  type Invite,
  type InviteStatus,
  type Paged,
  type SecurityConfig,
} from "./_admins";

type SortKey = "fullName" | "email" | "platformRole" | "lastLoginAt" | "createdAt";

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: "amber" | "red" | "green" | "blue";
}) {
  const color =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "green"
          ? "text-green-600 dark:text-green-400"
          : tone === "blue"
            ? "text-brand-600 dark:text-brand-300"
            : "text-ink";
  return (
    <Card className="min-w-[9rem] flex-1">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>
        {formatNumber(value ?? 0)}
      </p>
    </Card>
  );
}

/** Toggle the platform-wide "force 2FA" policy, capturing an optional reason. */
function SecurityPolicyModal({
  current,
  onClose,
  onSaved,
}: {
  current: boolean;
  onClose: () => void;
  onSaved: (c: SecurityConfig) => void;
}) {
  const next = !current;
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const c = await api.put<SecurityConfig>("/platform/admins/security-config", {
        force2faForPlatform: next,
        reason: reason.trim() || undefined,
      });
      toast.success(
        next
          ? "Two-factor is now required for platform admins"
          : "Two-factor requirement removed"
      );
      onSaved(c);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={next ? "Require 2FA for platform admins" : "Stop requiring 2FA"}
      open
      onClose={onClose}
    >
      <div className="space-y-4">
        <div
          className={
            next
              ? "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
              : "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          }
        >
          {next
            ? "Every platform admin without two-factor enabled will be required to set it up before they can continue."
            : "Platform admins will no longer be forced to enable two-factor. Existing 2FA stays in place."}
        </div>
        <Field label="Reason (optional — audited)">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this policy changing?"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={next ? "primary" : "danger"}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : next ? "Require 2FA" : "Remove requirement"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RowMenu({
  admin,
  isSelf,
  isLastOwner,
  open,
  onOpen,
  onClose,
  onView,
  onAction,
  onRevokeAll,
}: {
  admin: Admin;
  isSelf: boolean;
  isLastOwner: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onView: () => void;
  onAction: (a: AdminAction) => void;
  onRevokeAll: () => void;
}) {
  const item = (
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean; title?: string; danger?: boolean }
  ) => (
    <button
      disabled={opts?.disabled}
      title={opts?.title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
        onClose();
      }}
      className={
        opts?.disabled
          ? "block w-full cursor-not-allowed px-4 py-2 text-left text-sm text-faint"
          : opts?.danger
            ? "block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-hover dark:text-red-400"
            : "block w-full px-4 py-2 text-left text-sm text-ink hover:bg-hover"
      }
    >
      {label}
    </button>
  );

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (open) onClose();
          else onOpen();
        }}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-muted hover:bg-hover hover:text-ink"
      >
        Actions ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop">
            {item("View detail", onView)}
            {admin.isActive
              ? item("Disable", () => onAction("disable"), {
                  disabled: isSelf || isLastOwner,
                  title: isSelf
                    ? "You cannot disable yourself"
                    : isLastOwner
                      ? "Last owner — cannot be disabled"
                      : undefined,
                  danger: true,
                })
              : item("Enable", () => onAction("enable"))}
            {admin.locked
              ? item("Unlock", () => onAction("unlock"))
              : item("Lock", () => onAction("lock"), {
                  disabled: isSelf || isLastOwner,
                  title: isSelf
                    ? "You cannot lock yourself"
                    : isLastOwner
                      ? "Last owner — cannot be locked"
                      : undefined,
                  danger: true,
                })}
            {item("Change role", () => onAction("change-role"), {
              disabled: isLastOwner,
              title: isLastOwner ? "Last owner — cannot be demoted" : undefined,
            })}
            {item("Reset 2FA", () => onAction("reset-2fa"), {
              disabled: !admin.twoFactorEnabled,
              title: admin.twoFactorEnabled ? undefined : "2FA is not enabled",
            })}
            {item("Revoke all sessions", onRevokeAll, {
              disabled: admin.activeSessions === 0,
              title:
                admin.activeSessions === 0 ? "No active sessions" : undefined,
              danger: true,
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function PlatformAdminsPage() {
  const { ready, gate } = usePlatformGuard(
    "Platform Admins",
    "Internal platform-team user management & security controls"
  );
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [config, setConfig] = useState<SecurityConfig | null>(null);
  const [data, setData] = useState<Paged<Admin>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    action: AdminAction;
    admin: Admin;
  } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Admin | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Invite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, statusFilter, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
      if (roleFilter) p.set("platformRole", roleFilter);
      if (statusFilter) p.set("status", statusFilter);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      p.set("sort", sort);
      p.set("order", order);
      setData(await api.get<Paged<Admin>>(`/platform/admins?${p.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, roleFilter, statusFilter, page, pageSize, sort, order]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.get<AdminSummary>("/platform/admins/summary"));
    } catch {
      /* summary is best-effort */
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api.get<SecurityConfig>("/platform/admins/security-config"));
    } catch {
      /* best-effort */
    }
  }, []);

  const loadInvites = useCallback(async () => {
    try {
      setInvites(
        await api.get<Invite[]>(
          `/platform/admins/invites?status=${inviteStatus}`
        )
      );
    } catch {
      setInvites([]);
    }
  }, [inviteStatus]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  useEffect(() => {
    if (!ready) return;
    loadSummary();
    loadConfig();
  }, [ready, loadSummary, loadConfig]);

  useEffect(() => {
    if (ready) loadInvites();
  }, [ready, loadInvites]);

  const refreshAll = () => {
    load();
    loadSummary();
    loadInvites();
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("asc");
    }
  };

  const SortTh = ({
    label,
    k,
    className,
  }: {
    label: string;
    k: SortKey;
    className?: string;
  }) => (
    <th className={`px-4 py-3 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 uppercase hover:text-ink"
      >
        {label}
        {sort === k && <span>{order === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  const revokeAll = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const r = await api.post<{ revoked: number }>(
        `/platform/admins/${revokeTarget.id}/sessions/revoke-all`
      );
      toast.success(
        `Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"}`
      );
      setRevokeTarget(null);
      refreshAll();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke");
    } finally {
      setRevoking(false);
    }
  };

  const resendInvite = async (inv: Invite) => {
    try {
      const r = await api.post<{ emailSent: boolean }>(
        `/platform/admins/invites/${inv.id}/resend`
      );
      if (r.emailSent) toast.success(`Invite re-sent to ${inv.email}`);
      else toast.info("SMTP not configured — share the invite link manually");
      loadInvites();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to resend");
    }
  };

  const cancelInvite = async () => {
    if (!cancelTarget) return;
    setInviteBusy(true);
    try {
      await api.post(`/platform/admins/invites/${cancelTarget.id}/cancel`);
      toast.success("Invite cancelled");
      setCancelTarget(null);
      loadInvites();
      loadSummary();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to cancel");
    } finally {
      setInviteBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 20)));
  const hasFilters = useMemo(
    () => !!debouncedSearch || !!roleFilter || !!statusFilter,
    [debouncedSearch, roleFilter, statusFilter]
  );

  const isLastOwner = (a: Admin) =>
    a.platformRole === "owner" && (summary?.owners ?? 0) <= 1;

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Platform Admins"
        subtitle="Internal platform-team user management & security controls"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/admins/login-history")}
            >
              Login history
            </Button>
            <Button onClick={() => setShowInvite(true)}>
              <Icon name="userPlus" className="h-4 w-4" />
              Invite admin
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="mb-4 flex flex-wrap gap-3">
        <StatCard label="Total" value={summary?.total} />
        <StatCard label="Active" value={summary?.active} tone="green" />
        <StatCard label="Disabled" value={summary?.disabled} />
        <StatCard label="Locked" value={summary?.locked} tone="red" />
        <StatCard label="2FA enabled" value={summary?.with2fa} tone="blue" />
        <StatCard label="No 2FA" value={summary?.without2fa} tone="amber" />
        <StatCard label="Owners" value={summary?.owners} />
        <StatCard
          label="Pending invites"
          value={summary?.pendingInvites}
          tone="amber"
        />
      </div>

      {/* Security policy */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
              <Icon name="shield" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                Force 2FA for platform admins
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {config?.force2faForPlatform
                  ? "Every platform admin must have two-factor enabled to sign in."
                  : "Two-factor is recommended but not enforced for platform admins."}
              </p>
              {config?.updatedByEmail && (
                <p className="mt-1 text-xs text-faint">
                  Last changed by {config.updatedByEmail}
                  {config.updatedAt
                    ? ` · ${formatDateTime(config.updatedAt)}`
                    : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={config?.force2faForPlatform ? "green" : "slate"}>
              {config?.force2faForPlatform ? "Enforced" : "Off"}
            </Badge>
            <button
              type="button"
              role="switch"
              aria-checked={!!config?.force2faForPlatform}
              disabled={!config}
              onClick={() => setShowPolicy(true)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                config?.force2faForPlatform ? "bg-brand-600" : "bg-hover"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  config?.force2faForPlatform ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Search
          </label>
          <input
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-48">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Role
          </label>
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All roles</option>
            {PLATFORM_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Status
          </label>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="locked">Locked</option>
          </Select>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setRoleFilter("");
              setStatusFilter("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Admin list */}
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          message={
            hasFilters ? "No admins match these filters" : "No platform admins yet"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <SortTh label="Name" k="fullName" />
                  <SortTh label="Email" k="email" />
                  <SortTh label="Role" k="platformRole" />
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">2FA</th>
                  <SortTh label="Last login" k="lastLoginAt" />
                  <th className="px-4 py-3 text-right">Sessions</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => router.push(`/super-admin/admins/${a.id}`)}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/admins/${a.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-ink hover:text-brand-600"
                      >
                        {a.fullName}
                      </Link>
                      {a.id === currentUserId && (
                        <span className="ml-2 text-xs text-faint">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{a.email}</td>
                    <td className="px-4 py-3">
                      <Badge tone={roleTone(a.platformRole)}>
                        {roleLabel(a.platformRole)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {statusBadges(a).map((b) => (
                          <Badge key={b.label} tone={b.tone}>
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.twoFactorEnabled ? "green" : "amber"}>
                        {a.twoFactorEnabled ? "On" : "Off"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right text-ink">
                      {formatNumber(a.activeSessions)}
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowMenu
                        admin={a}
                        isSelf={a.id === currentUserId}
                        isLastOwner={isLastOwner(a)}
                        open={openMenu === a.id}
                        onOpen={() => setOpenMenu(a.id)}
                        onClose={() => setOpenMenu(null)}
                        onView={() => router.push(`/super-admin/admins/${a.id}`)}
                        onAction={(action) => setActionModal({ action, admin: a })}
                        onRevokeAll={() => setRevokeTarget(a)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>
                {data.total} admin{data.total === 1 ? "" : "s"}
              </span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-28"
              >
                <option value="10">10 / page</option>
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Invites */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Invites</h2>
          <div className="w-44">
            <Select
              value={inviteStatus}
              onChange={(e) => setInviteStatus(e.target.value as InviteStatus)}
            >
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </Select>
          </div>
        </div>
        {invites.length === 0 ? (
          <EmptyState message={`No ${inviteStatus} invites`} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Invited by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invites.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{inv.email}</span>
                      {inv.fullName && (
                        <span className="block text-xs text-faint">
                          {inv.fullName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={roleTone(inv.platformRole)}>
                        {roleLabel(inv.platformRole)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={inviteTone(inv.status)}>{inv.status}</Badge>
                        {inv.status === "pending" && inv.isExpired && (
                          <Badge tone="red">expired</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {inv.expiresAt ? formatDate(inv.expiresAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-faint">
                      {inv.invitedByEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {inv.status === "pending" ? (
                        <div className="flex justify-end gap-3 text-xs">
                          <button
                            onClick={() => resendInvite(inv)}
                            className="font-medium text-brand-600 hover:text-brand-700"
                          >
                            Resend
                          </button>
                          <button
                            onClick={() => setCancelTarget(inv)}
                            className="font-medium text-red-600 hover:text-red-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <AdminActionModal
        action={actionModal?.action ?? null}
        admin={actionModal?.admin ?? null}
        onClose={() => setActionModal(null)}
        onSuccess={refreshAll}
      />

      <InviteAdminModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onSuccess={() => {
          setInviteStatus("pending");
          loadInvites();
          loadSummary();
        }}
      />

      {showPolicy && config && (
        <SecurityPolicyModal
          current={config.force2faForPlatform}
          onClose={() => setShowPolicy(false)}
          onSaved={setConfig}
        />
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke all sessions"
        message={
          revokeTarget
            ? `Sign ${revokeTarget.fullName} out of all ${revokeTarget.activeSessions} active session(s)? They will need to sign in again.`
            : ""
        }
        confirmLabel="Revoke all"
        busy={revoking}
        onConfirm={revokeAll}
        onClose={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel invite"
        message={
          cancelTarget
            ? `Cancel the pending invite for ${cancelTarget.email}? The invite link will stop working.`
            : ""
        }
        confirmLabel="Cancel invite"
        cancelLabel="Keep invite"
        busy={inviteBusy}
        onConfirm={cancelInvite}
        onClose={() => setCancelTarget(null)}
      />
    </>
  );
}
