"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Icon } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { CreateRoleModal } from "./_modals";
import {
  downloadRbacExport,
  kindLabel,
  kindTone,
  statusLabel,
  statusTone,
  type RbacMe,
  type Role,
  type RoleDetail,
  type RoleKind,
  type RoleStatus,
} from "./_rbac";

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "blue" | "amber" | "violet";
}) {
  const color =
    tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "blue"
        ? "text-brand-600 dark:text-brand-300"
        : tone === "violet"
          ? "text-violet-600 dark:text-violet-400"
          : "text-ink";
  return (
    <Card className="min-w-[8.5rem] flex-1">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}

export default function RbacDashboardPage() {
  const { ready, gate } = usePlatformGuard(
    "Roles & permissions",
    "Custom roles, permission enforcement & governance"
  );
  const router = useRouter();

  const [roles, setRoles] = useState<Role[]>([]);
  const [me, setMe] = useState<RbacMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMyPerms, setShowMyPerms] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RoleStatus | "">("");
  const [kindFilter, setKindFilter] = useState<RoleKind | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      // Fetch the full role set once (roles are few) and filter client-side —
      // this keeps the summary tiles accurate regardless of the active filters.
      const [rolesData, meData] = await Promise.all([
        api.get<Role[]>("/platform/rbac/roles"),
        api.get<RbacMe>("/platform/rbac/me"),
      ]);
      setRoles(rolesData);
      setMe(meData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to load roles");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const summary = useMemo(() => {
    return {
      total: roles.length,
      builtIn: roles.filter((r) => r.kind === "built_in").length,
      custom: roles.filter((r) => r.kind === "custom").length,
      archived: roles.filter((r) => r.status === "archived").length,
    };
  }, [roles]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return roles.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (kindFilter && r.kind !== kindFilter) return false;
      if (
        term &&
        !r.name.toLowerCase().includes(term) &&
        !r.key.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [roles, search, statusFilter, kindFilter]);

  const hasFilters = !!search || !!statusFilter || !!kindFilter;

  const doExport = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      await downloadRbacExport(
        `/platform/rbac/export?format=${format}`,
        `rbac-matrix.${format}`
      );
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onCreated = (role: RoleDetail) => {
    load();
    router.push(`/super-admin/rbac/${role.key}`);
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader
          title="Roles & permissions"
          subtitle="Custom roles, permission enforcement & governance"
        />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Custom roles, permission enforcement & governance"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/rbac/matrix")}
            >
              <Icon name="grid" className="h-4 w-4" />
              Permission matrix
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/rbac/audit")}
            >
              <Icon name="file" className="h-4 w-4" />
              Audit
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Create role
            </Button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="mb-4 flex flex-wrap gap-3">
        <SummaryTile label="Total roles" value={summary.total} />
        <SummaryTile label="Built-in" value={summary.builtIn} tone="blue" />
        <SummaryTile label="Custom" value={summary.custom} tone="violet" />
        <SummaryTile label="Archived" value={summary.archived} tone="amber" />
        <SummaryTile
          label="Your permissions"
          value={me ? me.permissions.length : "—"}
          tone="blue"
        />
      </div>

      {/* Effective permissions (you) */}
      {me && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                <Icon name="shield" className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">
                  Effective permissions (you)
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Base role{" "}
                  <span className="font-medium text-ink capitalize">
                    {me.role.replace(/_/g, " ")}
                  </span>{" "}
                  · {me.permissions.length} permission
                  {me.permissions.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {me.isOwner ? (
                <Badge tone="blue">Owner · full access</Badge>
              ) : (
                <Badge tone="slate">Limited</Badge>
              )}
              <Button
                variant="ghost"
                onClick={() => setShowMyPerms((v) => !v)}
              >
                {showMyPerms ? "Hide" : "Show"} keys
              </Button>
            </div>
          </div>
          {showMyPerms && (
            <div className="mt-4 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto border-t border-line pt-4">
              {me.permissions.length === 0 ? (
                <span className="text-sm text-muted">No permissions.</span>
              ) : (
                [...me.permissions].sort().map((p) => (
                  <span
                    key={p}
                    className="rounded-md bg-hover px-2 py-0.5 font-mono text-xs text-muted"
                  >
                    {p}
                  </span>
                ))
              )}
            </div>
          )}
        </Card>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Search
          </label>
          <Input
            placeholder="Name or key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Type
          </label>
          <Select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as RoleKind | "")}
          >
            <option value="">All types</option>
            <option value="built_in">Built-in</option>
            <option value="custom">Custom</option>
          </Select>
        </div>
        <div className="w-44">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Status
          </label>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RoleStatus | "")}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatusFilter("");
              setKindFilter("");
            }}
          >
            Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => doExport("csv")}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => doExport("xlsx")}
          >
            Export XLSX
          </Button>
        </div>
      </div>

      <ErrorNote message={error} />

      {/* Role list */}
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          message={hasFilters ? "No roles match these filters" : "No roles yet"}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Permissions</th>
                <th className="px-4 py-3 text-right">Users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => (
                <tr
                  key={r.key}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => router.push(`/super-admin/rbac/${r.key}`)}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/super-admin/rbac/${r.key}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-ink hover:text-brand-600"
                    >
                      {r.name}
                    </Link>
                    {r.isOwner && (
                      <span className="ml-2 align-middle">
                        <Badge tone="blue">owner</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted">{r.key}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={kindTone(r.kind)}>{kindLabel(r.kind)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.status)}>
                      {statusLabel(r.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {r.isOwner ? "All" : r.permissionCount}
                  </td>
                  <td className="px-4 py-3 text-right text-ink">
                    {r.userCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {filtered.length} of {roles.length} role
          {roles.length === 1 ? "" : "s"} shown.
        </p>
      )}

      <CreateRoleModal
        open={showCreate}
        templates={roles}
        onClose={() => setShowCreate(false)}
        onCreated={onCreated}
      />
    </>
  );
}
