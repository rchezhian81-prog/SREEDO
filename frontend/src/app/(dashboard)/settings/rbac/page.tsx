"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  cx,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { usePermissions } from "@/lib/use-permissions";
import {
  appliesToLabel,
  diffKeys,
  flattenGranted,
  highRiskBadge,
  type AppliesTo,
  type RbacRegistry,
  type RoleDetail,
  type RoleListItem,
  type RolesListResponse,
  type RoleUser,
  type RoleUsersResponse,
} from "./_rbac";

/** Pending save payload — computed when the operator clicks "Review & save". */
interface PendingChange {
  added: string[];
  removed: string[];
  touchesHighRisk: boolean;
  permissions: string[];
}

/**
 * Applicability pill. Honours the house convention (College accents = violet,
 * School = brand-blue) while keeping the exact Badge shape.
 */
function TypeBadge({ appliesTo }: { appliesTo: AppliesTo }) {
  if (appliesTo === "college") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2.5 py-0.5 text-xs font-semibold capitalize text-violet-600 dark:text-violet-300">
        College
      </span>
    );
  }
  return (
    <Badge tone={appliesTo === "school" ? "blue" : "slate"}>
      {appliesToLabel(appliesTo)}
    </Badge>
  );
}

/** A single side of the before/after diff shown in the save confirm dialog. */
function DiffList({
  title,
  keys,
  tone,
  labelOf,
  highRiskSet,
}: {
  title: string;
  keys: string[];
  tone: "green" | "red";
  labelOf: Map<string, string>;
  highRiskSet: Set<string>;
}) {
  if (keys.length === 0) return null;
  const color =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  return (
    <div>
      <p
        className={`mb-1 text-xs font-semibold uppercase tracking-wide ${color}`}
      >
        {title} ({keys.length})
      </p>
      <ul className="space-y-1">
        {keys.map((k) => (
          <li key={k} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink">{labelOf.get(k) ?? k}</span>
            <span className="font-mono text-xs text-muted">{k}</span>
            {highRiskSet.has(k) && (
              <Badge tone={highRiskBadge()}>High-risk</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lazily-loaded list of the users currently assigned to a role. */
function RoleUsers({ roleKey }: { roleKey: string }) {
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .get<RoleUsersResponse>(`/tenant-rbac/roles/${roleKey}/users`)
      .then((res) => {
        if (active) setUsers(res.users);
      })
      .catch((err) => {
        if (!active) return;
        setUsers([]);
        setError(err instanceof ApiError ? err.message : "Failed to load users");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleKey]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (users.length === 0)
    return <EmptyState message="No users hold this role yet." />;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-surface-2">
              <td className="px-4 py-3 font-medium text-ink">{u.fullName}</td>
              <td className="px-4 py-3 text-muted">{u.email}</td>
              <td className="px-4 py-3">
                <Badge tone={u.isActive ? "green" : "slate"}>
                  {u.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TenantRbacPage() {
  const { can, loading: permsLoading } = usePermissions();
  const canRead = can("tenant_rbac:read");
  const canManage = can("tenant_rbac:manage");

  const [registry, setRegistry] = useState<RbacRegistry | null>(null);
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string>("");
  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [desired, setDesired] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-fetch just the role list (to refresh effective/override counts after a
  // save or reset). Registry is static, so it is loaded once up front.
  const refreshRoles = useCallback(async () => {
    const res = await api.get<RolesListResponse>("/tenant-rbac/roles");
    setRoles(res.roles);
  }, []);

  // Initial load: roles list + permission registry (once perms have settled).
  useEffect(() => {
    if (permsLoading || !canRead) return;
    let active = true;
    setListLoading(true);
    setListError(null);
    Promise.all([
      api.get<RolesListResponse>("/tenant-rbac/roles"),
      api.get<RbacRegistry>("/tenant-rbac/registry"),
    ])
      .then(([rolesRes, reg]) => {
        if (!active) return;
        setRoles(rolesRes.roles);
        setRegistry(reg);
      })
      .catch((err) => {
        if (!active) return;
        setListError(
          err instanceof ApiError ? err.message : "Failed to load roles"
        );
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [permsLoading, canRead]);

  // Auto-select the first role once the list arrives.
  useEffect(() => {
    if (!selected && roles.length > 0) setSelected(roles[0].key);
  }, [roles, selected]);

  // Seed the working sets from a freshly-loaded (or freshly-saved) role detail.
  const applyDetail = useCallback((d: RoleDetail) => {
    setDetail(d);
    const granted = new Set(flattenGranted(d));
    setBaseline(granted);
    setDesired(new Set(granted));
  }, []);

  // Load the selected role's detail.
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    api
      .get<RoleDetail>(`/tenant-rbac/roles/${selected}`)
      .then((d) => {
        if (active) applyDetail(d);
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setDetailError(
          err instanceof ApiError ? err.message : "Failed to load role"
        );
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, applyDetail]);

  const highRiskSet = useMemo(
    () => new Set(registry?.highRiskKeys ?? []),
    [registry]
  );

  // key -> label, for a readable before/after diff.
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    registry?.groups.forEach((g) =>
      g.permissions.forEach((p) => m.set(p.key, p.label))
    );
    detail?.groups.forEach((g) =>
      g.permissions.forEach((p) => {
        if (!m.has(p.key)) m.set(p.key, p.label);
      })
    );
    return m;
  }, [registry, detail]);

  const { added, removed } = useMemo(
    () => diffKeys(baseline, desired),
    [baseline, desired]
  );
  const dirty = added.length > 0 || removed.length > 0;

  const toggle = (key: string) => {
    if (!canManage) return;
    setDesired((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setGroup = (keys: string[], on: boolean) => {
    if (!canManage) return;
    setDesired((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });
  };

  const toggleCollapse = (groupKey: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });

  const discard = () => setDesired(new Set(baseline));

  const openSave = () => {
    const touchesHighRisk = [...added, ...removed].some((k) =>
      highRiskSet.has(k)
    );
    setPending({ added, removed, touchesHighRisk, permissions: [...desired] });
    setReason("");
    setConfirmOpen(true);
  };

  const doSave = async () => {
    if (!pending || !selected) return;
    setSaving(true);
    try {
      const updated = await api.put<RoleDetail>(
        `/tenant-rbac/roles/${selected}`,
        {
          permissions: pending.permissions,
          reason: reason.trim() || undefined,
        }
      );
      toast.success("Permissions updated");
      applyDetail(updated);
      setConfirmOpen(false);
      setPending(null);
      await refreshRoles().catch(() => undefined);
    } catch (err) {
      // Surface safety-rail / validation errors; keep the dialog open to retry.
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update permissions"
      );
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!selected) return;
    setResetting(true);
    try {
      const updated = await api.post<RoleDetail>(
        `/tenant-rbac/roles/${selected}/reset`
      );
      toast.success("Reset to defaults");
      applyDetail(updated);
      setResetOpen(false);
      await refreshRoles().catch(() => undefined);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to reset role"
      );
    } finally {
      setResetting(false);
    }
  };

  const term = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!detail) return [];
    return detail.groups
      .map((g) => ({
        ...g,
        permissions: term
          ? g.permissions.filter(
              (p) =>
                p.label.toLowerCase().includes(term) ||
                p.key.toLowerCase().includes(term)
            )
          : g.permissions,
      }))
      .filter((g) => g.permissions.length > 0);
  }, [detail, term]);

  // ---- Gating ----
  if (permsLoading) return <Spinner />;
  if (!canRead) {
    return (
      <>
        <PageHeader title="Roles & Permissions" />
        <EmptyState message="You don't have permission to manage roles. Ask an administrator." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/settings" className="hover:text-muted">
          Settings
        </Link>{" "}
        / <span className="text-muted">Roles &amp; permissions</span>
      </nav>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Grant or restrict what each built-in role can do in your institution"
        action={
          !canManage ? (
            <Badge tone="slate">
              <Icon name="lock" className="h-3 w-3" />
              Read-only
            </Badge>
          ) : undefined
        }
      />

      <ErrorNote message={listError} />

      {listLoading ? (
        <Spinner />
      ) : roles.length === 0 ? (
        <EmptyState message="No roles are defined." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]">
          {/* Role picker */}
          <aside className="space-y-2">
            {roles.map((r) => {
              const active = r.key === selected;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setSelected(r.key)}
                  className={cx(
                    "w-full rounded-2xl border p-4 text-left transition",
                    active
                      ? "border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/40"
                      : "border-line bg-surface hover:bg-surface-2"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-ink">{r.name}</span>
                    <TypeBadge appliesTo={r.appliesTo} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">
                    {r.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>
                      {r.effectiveCount} permission
                      {r.effectiveCount === 1 ? "" : "s"}
                    </span>
                    {r.overriddenCount > 0 && (
                      <Badge tone="amber">{r.overriddenCount} overridden</Badge>
                    )}
                    {r.restricted && <Badge tone="red">Restricted</Badge>}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Selected role detail */}
          <section className="min-w-0 space-y-4">
            {detailError ? (
              <ErrorNote message={detailError} />
            ) : detailLoading || !detail ? (
              <Spinner />
            ) : (
              <>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-ink">
                          {detail.role.name}
                        </h2>
                        <TypeBadge appliesTo={detail.role.appliesTo} />
                        {detail.role.management && (
                          <Badge tone="blue">Management</Badge>
                        )}
                        {detail.role.restricted && (
                          <Badge tone="red">Restricted</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {detail.role.description}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="secondary"
                        onClick={() => setResetOpen(true)}
                      >
                        <Icon name="history" className="h-4 w-4" />
                        Reset to default
                      </Button>
                    )}
                  </div>
                </Card>

                {/* Search */}
                <Input
                  placeholder="Search permissions…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                {/* Unsaved-changes banner */}
                {canManage && dirty && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <span className="font-semibold">Unsaved changes</span> ·{" "}
                      {added.length} added, {removed.length} removed
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" onClick={discard}>
                        Discard
                      </Button>
                      <Button onClick={openSave}>Review &amp; save</Button>
                    </div>
                  </div>
                )}

                {/* Permission groups */}
                {filteredGroups.length === 0 ? (
                  <EmptyState message="No permissions match your search." />
                ) : (
                  <div className="space-y-3">
                    {filteredGroups.map((g) => {
                      const keys = g.permissions.map((p) => p.key);
                      const grantedInGroup = keys.filter((k) =>
                        desired.has(k)
                      ).length;
                      const expanded = term.length > 0 || !collapsed.has(g.key);
                      return (
                        <div
                          key={g.key}
                          className="overflow-hidden rounded-xl border border-line bg-surface"
                        >
                          <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleCollapse(g.key)}
                              className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-ink"
                            >
                              <Icon
                                name={expanded ? "chevronDown" : "chevronRight"}
                                className="h-4 w-4 shrink-0 text-muted"
                              />
                              <span className="truncate">{g.title}</span>
                              {g.appliesTo !== "both" && (
                                <TypeBadge appliesTo={g.appliesTo} />
                              )}
                            </button>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="text-xs text-muted">
                                {grantedInGroup}/{g.permissions.length}
                              </span>
                              {canManage && expanded && (
                                <span className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setGroup(keys, true)}
                                    className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                                  >
                                    All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setGroup(keys, false)}
                                    className="text-xs font-medium text-muted hover:text-ink"
                                  >
                                    None
                                  </button>
                                </span>
                              )}
                            </div>
                          </div>
                          {expanded && (
                            <ul className="divide-y divide-line">
                              {g.permissions.map((p) => {
                                const checked = desired.has(p.key);
                                return (
                                  <li key={p.key}>
                                    <label
                                      className={cx(
                                        "flex items-start gap-3 px-4 py-3",
                                        canManage
                                          ? "cursor-pointer hover:bg-surface-2"
                                          : "cursor-default"
                                      )}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!canManage}
                                        onChange={() => toggle(p.key)}
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-60"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm font-medium text-ink">
                                            {p.label}
                                          </span>
                                          {p.highRisk && (
                                            <Badge tone={highRiskBadge()}>
                                              High-risk
                                            </Badge>
                                          )}
                                          {p.appliesTo !== "both" && (
                                            <TypeBadge appliesTo={p.appliesTo} />
                                          )}
                                          {p.override && (
                                            <Badge tone="blue">
                                              Overridden ·{" "}
                                              {p.override === "grant"
                                                ? "granted"
                                                : "denied"}
                                            </Badge>
                                          )}
                                        </span>
                                        <span className="mt-0.5 block font-mono text-xs text-muted">
                                          {p.key}
                                        </span>
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Users in this role */}
                <Card>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                    <Icon name="users" className="h-4 w-4 text-brand-600" />
                    Users in this role
                  </h3>
                  <RoleUsers roleKey={selected} />
                </Card>
              </>
            )}
          </section>
        </div>
      )}

      {/* Save confirm — before/after diff, plus a required reason on high-risk */}
      <ConfirmDialog
        open={confirmOpen}
        title={
          pending?.touchesHighRisk
            ? "Confirm high-risk change"
            : "Save permission changes"
        }
        tone={pending?.touchesHighRisk ? "danger" : "primary"}
        confirmLabel="Save changes"
        busy={saving}
        confirmDisabled={
          !!pending?.touchesHighRisk && reason.trim().length === 0
        }
        onConfirm={doSave}
        onClose={() => {
          if (saving) return;
          setConfirmOpen(false);
          setPending(null);
        }}
        message={
          pending ? (
            <div className="space-y-4">
              <p>
                Saving permissions for{" "}
                <span className="font-medium text-ink">
                  {detail?.role.name}
                </span>
                .
              </p>
              {pending.touchesHighRisk && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  This change touches high-risk permissions. A reason is required
                  and will be recorded in the audit log.
                </div>
              )}
              <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-4">
                <DiffList
                  title="Added"
                  keys={pending.added}
                  tone="green"
                  labelOf={labelOf}
                  highRiskSet={highRiskSet}
                />
                <DiffList
                  title="Removed"
                  keys={pending.removed}
                  tone="red"
                  labelOf={labelOf}
                  highRiskSet={highRiskSet}
                />
                {pending.added.length === 0 && pending.removed.length === 0 && (
                  <p className="text-sm text-muted">No changes.</p>
                )}
              </div>
              {pending.touchesHighRisk && (
                <Field label="Reason (required — audited)">
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this change being made?"
                  />
                </Field>
              )}
            </div>
          ) : null
        }
      />

      {/* Reset confirm */}
      <ConfirmDialog
        open={resetOpen}
        title="Reset to default?"
        tone="danger"
        confirmLabel="Reset"
        busy={resetting}
        message={
          <p>
            This clears every per-tenant override on{" "}
            <span className="font-medium text-ink">{detail?.role.name}</span>{" "}
            and restores the built-in defaults.
          </p>
        }
        onConfirm={doReset}
        onClose={() => {
          if (!resetting) setResetOpen(false);
        }}
      />
    </>
  );
}
