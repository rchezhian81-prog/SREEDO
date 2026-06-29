"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  PlatformAuditEntry,
  RbacGrantResult,
  RbacPermissionGroup,
  RbacRevokeResult,
  RbacRoleMatrixEntry,
} from "@/types";
import { usePlatformGuard } from "../platform/_guard";
import { compactDetail } from "../platform/_utils";

/** Column order for the matrix — every role in the system. */
const ROLES = [
  "super_admin",
  "admin",
  "teacher",
  "accountant",
  "student",
  "parent",
] as const;

type Role = (typeof ROLES)[number];

/** A protected cell: revoking a platform:* permission from super_admin is 400. */
function isProtectedCell(role: string, permissionKey: string): boolean {
  return role === "super_admin" && permissionKey.startsWith("platform:");
}

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h2>
  );
}

export default function RbacConsolePage() {
  const { ready, gate } = usePlatformGuard(
    "Roles & permissions",
    "Grant or revoke permissions per role"
  );

  const [groups, setGroups] = useState<RbacPermissionGroup[]>([]);
  const [matrix, setMatrix] = useState<RbacRoleMatrixEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  // Per-cell busy state, keyed `${role}::${permissionKey}`.
  const [busyCell, setBusyCell] = useState<string | null>(null);
  // Inline per-cell error (e.g. protected super-admin permission), same key.
  const [cellError, setCellError] = useState<{ key: string; message: string } | null>(
    null
  );

  // Audit trail (lazy-loaded on demand).
  const [auditRows, setAuditRows] = useState<PlatformAuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, m] = await Promise.all([
        api.get<RbacPermissionGroup[]>("/platform/permissions"),
        api.get<RbacRoleMatrixEntry[]>("/platform/roles"),
      ]);
      setGroups(g);
      setMatrix(m);
    } catch (err) {
      setGroups([]);
      setMatrix([]);
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load permission catalogue"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      // The platform audit endpoint is paginated ({ rows, total, ... }); RBAC
      // only needs the rows for its grant/revoke trail.
      const [grants, revokes] = await Promise.all([
        api.get<{ rows: PlatformAuditEntry[] }>("/platform/audit?action=rbac.grant&pageSize=200"),
        api.get<{ rows: PlatformAuditEntry[] }>("/platform/audit?action=rbac.revoke&pageSize=200"),
      ]);
      const merged = [...grants.rows, ...revokes.rows].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setAuditRows(merged);
    } catch (err) {
      setAuditRows([]);
      setAuditError(
        err instanceof ApiError ? err.message : "Failed to load audit trail"
      );
    } finally {
      setAuditLoading(false);
    }
  }, []);

  /**
   * Source of truth for "does `role` hold `permissionKey`": the catalogue's
   * per-permission `roles` array. This stays consistent with what the backend
   * reports after every refresh.
   */
  const heldByRole = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const group of groups) {
      for (const perm of group.permissions) {
        for (const role of perm.roles) {
          let set = map.get(role);
          if (!set) {
            set = new Set<string>();
            map.set(role, set);
          }
          set.add(perm.key);
        }
      }
    }
    return map;
  }, [groups]);

  const has = useCallback(
    (role: string, permissionKey: string): boolean =>
      heldByRole.get(role)?.has(permissionKey) ?? false,
    [heldByRole]
  );

  const moduleOptions = useMemo(
    () => groups.map((g) => g.module),
    [groups]
  );

  // Apply search + module + role filters to the grouped catalogue.
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .filter((g) => !moduleFilter || g.module === moduleFilter)
      .map((g) => ({
        module: g.module,
        permissions: g.permissions.filter((perm) => {
          if (
            term &&
            !perm.key.toLowerCase().includes(term) &&
            !perm.description.toLowerCase().includes(term)
          ) {
            return false;
          }
          // Role filter: only show permissions held by that role.
          if (roleFilter && !has(roleFilter, perm.key)) return false;
          return true;
        }),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [groups, search, moduleFilter, roleFilter, has]);

  // Which columns to render — all roles, or just the filtered one.
  const visibleRoles = useMemo<readonly Role[]>(
    () => (roleFilter ? ROLES.filter((r) => r === roleFilter) : ROLES),
    [roleFilter]
  );

  const totalVisible = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.permissions.length, 0),
    [filteredGroups]
  );

  async function toggleCell(role: string, permissionKey: string) {
    const cellKey = `${role}::${permissionKey}`;
    if (busyCell) return;
    setCellError(null);

    const currentlyHas = has(role, permissionKey);

    // Block obviously-protected revokes client-side too (defence in depth).
    if (currentlyHas && isProtectedCell(role, permissionKey)) {
      setCellError({
        key: cellKey,
        message: "Critical super-admin permission cannot be revoked.",
      });
      return;
    }

    setBusyCell(cellKey);
    try {
      if (currentlyHas) {
        await api.post<RbacRevokeResult>(
          `/platform/roles/${role}/permissions/revoke`,
          { permissionKey }
        );
      } else {
        await api.post<RbacGrantResult>(
          `/platform/roles/${role}/permissions`,
          { permissionKey }
        );
      }
      await load();
      // Refresh the audit trail if it's currently shown.
      if (auditRows !== null) await loadAudit();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        isProtectedCell(role, permissionKey)
      ) {
        setCellError({
          key: cellKey,
          message: "Critical super-admin permission cannot be revoked.",
        });
      } else {
        setCellError({
          key: cellKey,
          message:
            err instanceof ApiError
              ? err.message
              : currentlyHas
                ? "Failed to revoke permission"
                : "Failed to grant permission",
        });
      }
    } finally {
      setBusyCell(null);
    }
  }

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Grant or revoke permissions per role"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => (auditRows === null ? loadAudit() : setAuditRows(null))}
              disabled={loading}
            >
              {auditRows === null ? "View audit trail" : "Hide audit trail"}
            </Button>
            <Button variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Search
            </span>
            <Input
              placeholder="Filter by permission key or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-52">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Module
            </span>
            <Select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              <option value="">All modules</option>
              {moduleOptions.map((mod) => (
                <option key={mod} value={mod}>
                  {mod}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Role
            </span>
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All roles</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </div>
          {(search || moduleFilter || roleFilter) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setModuleFilter("");
                setRoleFilter("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Click a cell to grant (−) or revoke (✓) a permission for that role.
          Critical <code className="font-mono">platform:*</code> permissions for
          the super administrator are locked.
        </p>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        !error ? (
          <EmptyState message="No permissions are defined." />
        ) : null
      ) : totalVisible === 0 ? (
        <EmptyState message="No permissions match these filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Permission</th>
                {visibleRoles.map((role) => (
                  <th key={role} className="px-3 py-3 text-center capitalize">
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredGroups.map((group) => (
                <ModuleRows
                  key={group.module}
                  module={group.module}
                  permissions={group.permissions}
                  visibleRoles={visibleRoles}
                  has={has}
                  busyCell={busyCell}
                  cellError={cellError}
                  onToggle={toggleCell}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && totalVisible > 0 && (
        <p className="mt-3 text-sm text-slate-500">
          {totalVisible} {totalVisible === 1 ? "permission" : "permissions"}{" "}
          shown across {matrix.length || ROLES.length} roles.
        </p>
      )}

      {auditRows !== null && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between gap-3">
            <SectionHeading>Recent grants &amp; revokes</SectionHeading>
            <Button
              variant="secondary"
              onClick={loadAudit}
              disabled={auditLoading}
            >
              {auditLoading ? "Loading…" : "Reload"}
            </Button>
          </div>
          <ErrorNote message={auditError} />
          {auditLoading ? (
            <Spinner />
          ) : auditRows.length === 0 ? (
            !auditError ? (
              <EmptyState message="No grant or revoke activity recorded yet." />
            ) : null
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Role &amp; permission</th>
                    <th className="px-4 py-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditRows.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatTimestamp(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={row.action === "rbac.revoke" ? "red" : "green"}
                        >
                          {row.action === "rbac.revoke" ? "revoke" : "grant"}
                        </Badge>
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <span className="block truncate font-mono text-xs text-slate-500">
                          {compactDetail(row.detail)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.actorEmail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ModuleRows({
  module,
  permissions,
  visibleRoles,
  has,
  busyCell,
  cellError,
  onToggle,
}: {
  module: string;
  permissions: { key: string; description: string }[];
  visibleRoles: readonly Role[];
  has: (role: string, permissionKey: string) => boolean;
  busyCell: string | null;
  cellError: { key: string; message: string } | null;
  onToggle: (role: string, permissionKey: string) => void;
}) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td
          colSpan={visibleRoles.length + 1}
          className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          {module}
        </td>
      </tr>
      {permissions.map((perm) => (
        <tr key={perm.key} className="align-top hover:bg-slate-50">
          <td className="px-4 py-3">
            <span className="block font-mono text-xs text-slate-700">
              {perm.key}
            </span>
            <span className="mt-0.5 block text-xs text-slate-400">
              {perm.description}
            </span>
          </td>
          {visibleRoles.map((role) => {
            const cellKey = `${role}::${perm.key}`;
            const held = has(role, perm.key);
            const busy = busyCell === cellKey;
            const protectedCell =
              held && isProtectedCell(role, perm.key);
            const err = cellError?.key === cellKey ? cellError.message : null;
            return (
              <td key={role} className="px-3 py-3 text-center">
                <button
                  type="button"
                  onClick={() => onToggle(role, perm.key)}
                  disabled={busy || !!busyCell || protectedCell}
                  title={
                    protectedCell
                      ? "Critical super-admin permission cannot be revoked."
                      : held
                        ? "Click to revoke"
                        : "Click to grant"
                  }
                  aria-label={`${held ? "Revoke" : "Grant"} ${perm.key} for ${roleLabel(
                    role
                  )}`}
                  className={cellButtonClass(held, protectedCell)}
                >
                  {busy ? "…" : held ? "✓" : "−"}
                </button>
                {err && (
                  <span className="mt-1 block text-[10px] leading-tight text-red-600">
                    {err}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function cellButtonClass(held: boolean, protectedCell: boolean): string {
  const base =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm font-semibold transition disabled:cursor-not-allowed";
  if (protectedCell) {
    return `${base} border-emerald-200 bg-emerald-50 text-emerald-600 opacity-70`;
  }
  if (held) {
    return `${base} border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200`;
  }
  return `${base} border-slate-200 bg-white text-slate-300 hover:border-brand-300 hover:text-brand-500`;
}
