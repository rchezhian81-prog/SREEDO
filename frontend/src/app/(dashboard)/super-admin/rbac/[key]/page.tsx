"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { usePlatformGuard } from "../../platform/_guard";
import { ArchiveRoleModal, EditRoleModal } from "../_modals";
import {
  formatDateTime,
  isHighRisk,
  kindLabel,
  kindTone,
  statusLabel,
  statusTone,
  type RegistryGroup,
  type RoleDetail,
  type RoleUser,
} from "../_rbac";

const TABS = ["Overview", "Permissions", "Users"] as const;
type Tab = (typeof TABS)[number];
const tabSlug = (name: string) => name.toLowerCase();

export default function RoleDetailPage() {
  const { key } = useParams<{ key: string }>();
  const { ready, gate } = usePlatformGuard("Role", "Role detail");

  const [role, setRole] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  // Deep-link ?tab= (client-only).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (!raw) return;
    const match = TABS.find((t) => tabSlug(t) === raw.toLowerCase());
    if (match) setTab(match);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);
    try {
      setRole(await api.get<RoleDetail>(`/platform/rbac/roles/${key}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load role");
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Role" subtitle={String(key)} />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }
  if (loading) return <Spinner />;
  if (notFound) return <ErrorNote message="Role not found" />;
  if (error && !role) return <ErrorNote message={error} />;
  if (!role) return <ErrorNote message="Role not found" />;

  const canArchive = !role.isOwner && !role.isSystem && role.status !== "archived";

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/rbac" className="hover:text-muted">
          Roles &amp; permissions
        </Link>{" "}
        / <span className="text-muted">{role.key}</span>
      </nav>
      <PageHeader
        title={role.name}
        subtitle={role.description || "No description"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={kindTone(role.kind)}>{kindLabel(role.kind)}</Badge>
            <Badge tone={statusTone(role.status)}>
              {statusLabel(role.status)}
            </Badge>
            {role.isOwner && <Badge tone="blue">owner · full access</Badge>}
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      {/* Action toolbar */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowEdit(true)}>
          <Icon name="wrench" className="h-4 w-4" />
          Edit
        </Button>
        {!role.isOwner && (
          <Link href={`/super-admin/rbac/matrix?role=${role.key}`}>
            <Button variant="secondary">
              <Icon name="grid" className="h-4 w-4" />
              Edit permissions
            </Button>
          </Link>
        )}
        {canArchive && (
          <Button variant="danger" onClick={() => setShowArchive(true)}>
            Archive
          </Button>
        )}
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

      {tab === "Overview" && <OverviewTab role={role} />}
      {tab === "Permissions" && <PermissionsTab role={role} />}
      {tab === "Users" && <UsersTab roleKey={role.key} />}

      <EditRoleModal
        role={showEdit ? role : null}
        onClose={() => setShowEdit(false)}
        onSaved={(updated) => setRole(updated)}
      />
      <ArchiveRoleModal
        role={showArchive ? role : null}
        onClose={() => setShowArchive(false)}
        onArchived={(updated) => setRole(updated)}
      />
    </>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function OverviewTab({ role }: { role: RoleDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Key" value={role.key} />
        <Tile label="Type" value={kindLabel(role.kind)} />
        <Tile label="Status" value={statusLabel(role.status)} />
        <Tile
          label="Permissions"
          value={role.isOwner ? "All (full access)" : role.permissionCount}
        />
        <Tile label="Users assigned" value={role.userCount} />
        <Tile label="Created by" value={role.createdByEmail ?? "—"} />
        <Tile label="Created" value={formatDateTime(role.createdAt)} />
        <Tile label="Updated by" value={role.updatedByEmail ?? "—"} />
        <Tile label="Last updated" value={formatDateTime(role.updatedAt)} />
      </div>
      {role.isOwner && (
        <Card>
          <p className="text-sm text-muted">
            The owner role has full, unrestricted access — its permissions are
            not editable and it cannot be archived or disabled. The last active
            owner is protected from demotion.
          </p>
        </Card>
      )}
    </div>
  );
}

function PermissionsTab({ role }: { role: RoleDetail }) {
  const [groups, setGroups] = useState<RegistryGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get<RegistryGroup[]>("/platform/rbac/registry")
      .then((g) => active && setGroups(g))
      .catch(() => active && setGroups([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const granted = useMemo(() => new Set(role.permissions), [role.permissions]);

  if (role.isOwner) {
    return (
      <Card>
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">Full access.</span> The owner
          role holds every permission by design.
        </p>
      </Card>
    );
  }

  if (loading) return <Spinner />;

  // Only show groups that have at least one granted permission.
  const grantedGroups = groups
    .map((g) => ({
      group: g.group,
      permissions: g.permissions.filter((p) => granted.has(p.key)),
    }))
    .filter((g) => g.permissions.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {role.permissionCount} permission
          {role.permissionCount === 1 ? "" : "s"} granted
        </p>
        <Link href={`/super-admin/rbac/matrix?role=${role.key}`}>
          <Button variant="secondary">
            <Icon name="grid" className="h-4 w-4" />
            Open in matrix
          </Button>
        </Link>
      </div>
      {grantedGroups.length === 0 ? (
        <EmptyState message="This role has no permissions granted yet." />
      ) : (
        <div className="space-y-4">
          {grantedGroups.map((g) => (
            <Card key={g.group}>
              <h3 className="mb-3 text-sm font-semibold text-ink">{g.group}</h3>
              <ul className="space-y-2">
                {g.permissions.map((p) => (
                  <li
                    key={p.key}
                    className="flex flex-wrap items-center gap-2 border-b border-line pb-2 last:border-0 last:pb-0"
                  >
                    <Icon
                      name="check"
                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                    />
                    <span className="font-mono text-xs text-ink">{p.key}</span>
                    {isHighRisk(p.key) && (
                      <Badge tone="amber">high-risk</Badge>
                    )}
                    <span className="text-xs text-muted">{p.description}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UsersTab({ roleKey }: { roleKey: string }) {
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<RoleUser[]>(`/platform/rbac/roles/${roleKey}/users`)
      .then((u) => active && setUsers(u))
      .catch((err) => {
        if (!active) return;
        setUsers([]);
        setError(err instanceof ApiError ? err.message : "Failed to load users");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [roleKey]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (users.length === 0)
    return <EmptyState message="No platform admins hold this role." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Last login</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-surface-2">
              <td className="px-4 py-3">
                <Link
                  href={`/super-admin/admins/${u.id}`}
                  className="font-medium text-ink hover:text-brand-600"
                >
                  {u.fullName}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted">{u.email}</td>
              <td className="px-4 py-3">
                <Badge tone={u.isActive ? "green" : "slate"}>
                  {u.isActive ? "Active" : "Disabled"}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted">
                {formatDateTime(u.lastLoginAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
