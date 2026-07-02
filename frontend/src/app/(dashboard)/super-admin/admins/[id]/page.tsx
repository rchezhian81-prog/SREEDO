"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../../platform/_guard";
import { formatNumber } from "../../platform/_utils";
import { AdminActionModal, type AdminAction } from "../_modals";
import {
  formatDateTime,
  roleLabel,
  roleTone,
  shortUserAgent,
  statusBadges,
  type Admin,
  type AdminSession,
  type AdminSummary,
  type LoginEvent,
  type Paged,
} from "../_admins";

const TABS = ["Overview", "Sessions", "Login history"] as const;
type Tab = (typeof TABS)[number];
const tabSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function AdminDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, gate } = usePlatformGuard("Platform Admin", "Admin detail");
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [d, setD] = useState<Admin | null>(null);
  const [ownerCount, setOwnerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [action, setAction] = useState<AdminAction | null>(null);

  // Deep-link ?tab= (client-only; avoids the useSearchParams Suspense need).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (!raw) return;
    const match = TABS.find((t) => tabSlug(t) === raw.toLowerCase());
    if (match) setTab(match);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setD(await api.get<Admin>(`/platform/admins/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load admin");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadOwners = useCallback(async () => {
    try {
      const s = await api.get<AdminSummary>("/platform/admins/summary");
      setOwnerCount(s.owners);
    } catch {
      setOwnerCount(null);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      load();
      loadOwners();
    }
  }, [ready, load, loadOwners]);

  if (!ready) return gate;
  if (loading) return <Spinner />;
  if (error && !d) return <ErrorNote message={error} />;
  if (!d) return <ErrorNote message="Platform admin not found" />;

  const isSelf = d.id === currentUserId;
  const isLastOwner = d.platformRole === "owner" && (ownerCount ?? 0) <= 1;

  const onActionSuccess = (updated: Admin) => {
    setD(updated);
    loadOwners();
  };

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/admins" className="hover:text-muted">
          Platform Admins
        </Link>{" "}
        / <span className="text-muted">{d.email}</span>
      </nav>
      <PageHeader
        title={d.fullName}
        subtitle={d.email}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={roleTone(d.platformRole)}>
              {roleLabel(d.platformRole)}
            </Badge>
            {statusBadges(d).map((b) => (
              <Badge key={b.label} tone={b.tone}>
                {b.label}
              </Badge>
            ))}
            {isSelf && <Badge tone="blue">you</Badge>}
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      {/* Action toolbar */}
      <div className="mb-4 flex flex-wrap gap-2">
        {d.isActive ? (
          <Button
            variant="danger"
            disabled={isSelf || isLastOwner}
            title={
              isSelf
                ? "You cannot disable yourself"
                : isLastOwner
                  ? "Last owner — cannot be disabled"
                  : undefined
            }
            onClick={() => setAction("disable")}
          >
            Disable
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setAction("enable")}>
            Enable
          </Button>
        )}
        {d.locked ? (
          <Button variant="secondary" onClick={() => setAction("unlock")}>
            Unlock
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={isSelf || isLastOwner}
            title={
              isSelf
                ? "You cannot lock yourself"
                : isLastOwner
                  ? "Last owner — cannot be locked"
                  : undefined
            }
            onClick={() => setAction("lock")}
          >
            Lock
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!d.twoFactorEnabled}
          title={d.twoFactorEnabled ? undefined : "2FA is not enabled"}
          onClick={() => setAction("reset-2fa")}
        >
          Reset 2FA
        </Button>
        <Button
          variant="secondary"
          disabled={isLastOwner}
          title={isLastOwner ? "Last owner — cannot be demoted" : undefined}
          onClick={() => setAction("change-role")}
        >
          Change role
        </Button>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={
              tab === x
                ? "border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-700 dark:text-brand-300"
                : "px-3 py-2 text-sm font-medium text-muted hover:text-ink"
            }
          >
            {x}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab d={d} />}
      {tab === "Sessions" && <SessionsTab id={id} onChanged={load} />}
      {tab === "Login history" && <LoginHistoryTab email={d.email} />}

      <AdminActionModal
        action={action}
        admin={action ? d : null}
        onClose={() => setAction(null)}
        onSuccess={onActionSuccess}
      />
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "red" | "amber";
}) {
  const color =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

function OverviewTab({ d }: { d: Admin }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Role" value={roleLabel(d.platformRole)} />
        <Tile
          label="Status"
          value={d.locked ? "Locked" : d.isActive ? "Active" : "Disabled"}
          tone={d.locked ? "red" : undefined}
        />
        <Tile
          label="Two-factor"
          value={d.twoFactorEnabled ? "Enabled" : "Not enabled"}
          tone={d.twoFactorEnabled ? undefined : "amber"}
        />
        <Tile
          label="Failed logins"
          value={formatNumber(d.failedLoginAttempts)}
          tone={d.failedLoginAttempts > 0 ? "amber" : undefined}
        />
        <Tile
          label="Last login"
          value={d.lastLoginAt ? formatDateTime(d.lastLoginAt) : "Never"}
        />
        <Tile label="Created" value={formatDateTime(d.createdAt)} />
        <Tile
          label="Last activity"
          value={d.lastActivityAt ? formatDateTime(d.lastActivityAt) : "—"}
        />
        <Tile label="Active sessions" value={formatNumber(d.activeSessions)} />
      </div>
      {d.locked && d.lockedUntil && (
        <Card>
          <p className="text-sm text-muted">
            Locked until{" "}
            <span className="font-medium text-ink">
              {formatDateTime(d.lockedUntil)}
            </span>
            . Use <span className="font-medium text-ink">Unlock</span> above to
            restore access.
          </p>
        </Card>
      )}
    </div>
  );
}

function SessionsTab({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(
        await api.get<AdminSession[]>(`/platform/admins/${id}/sessions`)
      );
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const revokeOne = async (sid: string) => {
    setRevokingId(sid);
    try {
      await api.delete(`/platform/admins/${id}/sessions/${sid}`);
      toast.success("Session revoked");
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke");
    } finally {
      setRevokingId(null);
    }
  };

  const revokeAll = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ revoked: number }>(
        `/platform/admins/${id}/sessions/revoke-all`
      );
      toast.success(`Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"}`);
      setRevokeAllOpen(false);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {sessions.length} active session{sessions.length === 1 ? "" : "s"}
        </p>
        <Button
          variant="danger"
          disabled={sessions.length === 0}
          onClick={() => setRevokeAllOpen(true)}
        >
          Revoke all
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : sessions.length === 0 ? (
        <EmptyState message="No active sessions" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Signed in</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">
                      {shortUserAgent(s.userAgent)}
                    </span>
                    {s.userAgent && (
                      <span className="block max-w-md truncate text-xs text-faint">
                        {s.userAgent}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{s.ip ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">
                    {formatDateTime(s.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDateTime(s.lastUsedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={revokingId === s.id}
                      onClick={() => revokeOne(s.id)}
                      className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {revokingId === s.id ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={revokeAllOpen}
        title="Revoke all sessions"
        message="Sign this admin out of every active session? They will need to sign in again."
        confirmLabel="Revoke all"
        busy={busy}
        onConfirm={revokeAll}
        onClose={() => setRevokeAllOpen(false)}
      />
    </div>
  );
}

function LoginHistoryTab({ email }: { email: string }) {
  const [data, setData] = useState<Paged<LoginEvent>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [outcome]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("q", email);
      if (outcome) p.set("outcome", outcome);
      p.set("page", String(page));
      p.set("pageSize", "25");
      setData(
        await api.get<Paged<LoginEvent>>(
          `/platform/admins/login-history?${p.toString()}`
        )
      );
    } catch {
      setData({ rows: [], total: 0, page: 1, pageSize: 25 });
    } finally {
      setLoading(false);
    }
  }, [email, outcome, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));

  return (
    <div className="space-y-4">
      <div className="w-44">
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">All outcomes</option>
          <option value="success">Successful</option>
          <option value="failed">Failed</option>
        </Select>
      </div>
      {loading ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No login events recorded for this admin" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 text-muted">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.success ? "green" : "red"}>
                        {e.success ? "success" : "failed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{e.ip ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">
                      {shortUserAgent(e.userAgent)}
                    </td>
                    <td className="px-4 py-3 text-faint">{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} event{data.total === 1 ? "" : "s"}
            </span>
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
    </div>
  );
}
