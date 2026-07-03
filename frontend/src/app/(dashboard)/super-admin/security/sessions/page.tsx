"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import { ReasonModal } from "../_modals";
import {
  formatDateTime,
  roleLabel,
  roleTone,
  shortUserAgent,
  type Paged,
  type SessionRow,
} from "../_security";

interface RoleOption {
  key: string;
  name: string;
}

type SessionAction =
  | { kind: "session"; session: SessionRow }
  | { kind: "user"; session: SessionRow }
  | { kind: "role"; roleKey: string; roleName: string };

const REVOKE_NOTE =
  "Revocation stops future refreshes; existing access tokens expire within their TTL.";

export default function SessionsPage() {
  const { ready, gate } = usePlatformGuard(
    "Active sessions",
    "Every active platform-admin session"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [data, setData] = useState<Paged<SessionRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [action, setAction] = useState<SessionAction | null>(null);
  const [revokeRole, setRevokeRole] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, roleFilter]);

  useEffect(() => {
    if (!ready) return;
    api
      .get<RoleOption[]>("/platform/rbac/roles?status=active")
      .then((rs) => setRoles(rs.map((r) => ({ key: r.key, name: r.name }))))
      .catch(() => setRoles([]));
  }, [ready]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = new URLSearchParams();
      if (debounced.trim()) p.set("q", debounced.trim());
      if (roleFilter) p.set("role", roleFilter);
      p.set("page", String(page));
      p.set("pageSize", "25");
      setData(
        await api.get<Paged<SessionRow>>(`/platform/security/sessions?${p.toString()}`)
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [debounced, roleFilter, page]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const runAction = async (reason: string) => {
    if (!action) return;
    if (action.kind === "session") {
      const r = await api.post<{ revoked: number }>(
        `/platform/security/sessions/${action.session.id}/revoke`,
        { reason }
      );
      toast.success(`Revoked ${r.revoked} session`);
    } else if (action.kind === "user") {
      const r = await api.post<{ revoked: number }>(
        `/platform/security/users/${action.session.userId}/sessions/revoke-all`,
        { reason }
      );
      toast.success(
        `Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"} for ${action.session.userName}`
      );
    } else {
      const r = await api.post<{ revoked: number }>(
        `/platform/security/roles/${action.roleKey}/sessions/revoke`,
        { reason }
      );
      toast.success(
        `Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"} for ${action.roleName}`
      );
    }
    load();
  };

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));

  const modal = action
    ? action.kind === "session"
      ? {
          title: "Revoke session",
          cta: "Revoke session",
          description: (
            <>
              Revoke this session for{" "}
              <span className="font-medium text-ink">{action.session.userName}</span>?
            </>
          ),
        }
      : action.kind === "user"
        ? {
            title: "Revoke all sessions for user",
            cta: "Revoke all",
            description: (
              <>
                Sign{" "}
                <span className="font-medium text-ink">{action.session.userName}</span>{" "}
                out of all their sessions? Your own session is unaffected.
              </>
            ),
          }
        : {
            title: "Revoke all sessions for role",
            cta: "Revoke sessions",
            description: (
              <>
                Revoke every session held by admins in{" "}
                <span className="font-medium text-ink">{action.roleName}</span>? Your
                own session is kept.
              </>
            ),
          }
    : null;

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Active sessions" subtitle="Every active platform-admin session" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/security" className="hover:text-muted">
          Security Center
        </Link>{" "}
        / <span className="text-muted">Sessions</span>
      </nav>
      <PageHeader
        title="Active sessions"
        subtitle="Every active platform-admin session"
      />

      <div className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
        {REVOKE_NOTE} Token values are never shown here.
      </div>

      {/* Filters + role revoke */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">Search</label>
          <Input
            placeholder="Name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-52">
          <label className="mb-1.5 block text-sm font-medium text-ink">Role</label>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        {canManage && (
          <div className="flex items-end gap-2">
            <div className="w-52">
              <label className="mb-1.5 block text-sm font-medium text-ink">
                Revoke all for role
              </label>
              <Select
                value={revokeRole}
                onChange={(e) => setRevokeRole(e.target.value)}
              >
                <option value="">Select a role…</option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="danger"
              disabled={!revokeRole}
              onClick={() => {
                const r = roles.find((x) => x.key === revokeRole);
                if (r) setAction({ kind: "role", roleKey: r.key, roleName: r.name });
              }}
            >
              Revoke
            </Button>
          </div>
        )}
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No active sessions match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Signed in</th>
                  <th className="px-4 py-3">Last used</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((s) => (
                  <tr key={s.id} className="align-top hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/admins/${s.userId}`}
                        className="font-medium text-ink hover:text-brand-600"
                      >
                        {s.userName}
                      </Link>
                      <span className="block text-xs text-faint">{s.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={roleTone(s.platformRole)}>
                        {roleLabel(s.platformRole)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {s.ip ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {shortUserAgent(s.userAgent)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDateTime(s.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDateTime(s.lastUsedAt)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => setAction({ kind: "session", session: s })}
                          >
                            Revoke
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setAction({ kind: "user", session: s })}
                          >
                            All
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} session{data.total === 1 ? "" : "s"}
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

      <ReasonModal
        open={!!action}
        title={modal?.title ?? ""}
        cta={modal?.cta ?? "Revoke"}
        danger
        warning={{ tone: "amber", text: REVOKE_NOTE }}
        description={modal?.description}
        onSubmit={runAction}
        onClose={() => setAction(null)}
      />
    </>
  );
}
