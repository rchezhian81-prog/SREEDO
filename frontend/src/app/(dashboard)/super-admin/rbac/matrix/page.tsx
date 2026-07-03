"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { usePlatformGuard } from "../../platform/_guard";
import {
  isHighRisk,
  type MatrixEntry,
  type RegistryGroup,
} from "../_rbac";

export default function PermissionMatrixPage() {
  const { ready, gate } = usePlatformGuard(
    "Permission matrix",
    "Grant permissions per role"
  );

  const [groups, setGroups] = useState<RegistryGroup[]>([]);
  const [matrix, setMatrix] = useState<MatrixEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showDiff, setShowDiff] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [g, m] = await Promise.all([
        api.get<RegistryGroup[]>("/platform/rbac/registry"),
        api.get<MatrixEntry[]>("/platform/rbac/matrix"),
      ]);
      setGroups(g);
      setMatrix(m);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load matrix");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const editableRoles = useMemo(
    () => matrix.filter((m) => !m.isOwner),
    [matrix]
  );
  const ownerRole = useMemo(() => matrix.find((m) => m.isOwner), [matrix]);

  // Pick the initial role: ?role= from the URL if editable, else the first
  // editable role.
  useEffect(() => {
    if (editableRoles.length === 0 || selectedKey) return;
    const raw = new URLSearchParams(window.location.search).get("role");
    const preset = raw && editableRoles.some((r) => r.key === raw) ? raw : null;
    setSelectedKey(preset ?? editableRoles[0].key);
  }, [editableRoles, selectedKey]);

  const selectedEntry = useMemo(
    () => matrix.find((m) => m.key === selectedKey) ?? null,
    [matrix, selectedKey]
  );

  const original = useMemo(() => {
    if (!selectedEntry || selectedEntry.permissions === "*")
      return new Set<string>();
    return new Set(selectedEntry.permissions);
  }, [selectedEntry]);

  // Reset the working draft whenever the selected role (or the matrix) changes.
  useEffect(() => {
    if (!selectedEntry || selectedEntry.permissions === "*") {
      setDraft(new Set());
    } else {
      setDraft(new Set(selectedEntry.permissions));
    }
  }, [selectedEntry]);

  const toggle = (permKey: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permKey)) next.delete(permKey);
      else next.add(permKey);
      return next;
    });
  };

  const added = useMemo(
    () => [...draft].filter((k) => !original.has(k)).sort(),
    [draft, original]
  );
  const removed = useMemo(
    () => [...original].filter((k) => !draft.has(k)).sort(),
    [draft, original]
  );
  const dirty = added.length > 0 || removed.length > 0;
  const touchesHighRisk = useMemo(
    () => [...added, ...removed].some(isHighRisk),
    [added, removed]
  );

  const groupNames = useMemo(() => groups.map((g) => g.group), [groups]);

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .filter((g) => !groupFilter || g.group === groupFilter)
      .map((g) => ({
        group: g.group,
        permissions: g.permissions.filter((p) => {
          if (!term) return true;
          return (
            p.key.toLowerCase().includes(term) ||
            p.description.toLowerCase().includes(term)
          );
        }),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [groups, search, groupFilter]);

  const searching = search.trim().length > 0;
  const isExpanded = (group: string) => searching || !collapsed.has(group);
  const toggleGroup = (group: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const onSaved = async () => {
    await load();
    setShowDiff(false);
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Permission matrix" subtitle="Grant permissions per role" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  const isOwnerSelected = selectedEntry?.permissions === "*";

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/rbac" className="hover:text-muted">
          Roles &amp; permissions
        </Link>{" "}
        / <span className="text-muted">Permission matrix</span>
      </nav>
      <PageHeader
        title="Permission matrix"
        subtitle="Toggle a role's permissions, then review the diff and save"
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : matrix.length === 0 ? (
        <EmptyState message="No roles are defined." />
      ) : (
        <>
          {/* Role picker + owner note */}
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <label className="mb-1.5 block text-sm font-medium text-ink">
                  Role
                </label>
                <Select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                >
                  {editableRoles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name} ({r.key})
                    </option>
                  ))}
                </Select>
              </div>
              {ownerRole && (
                <p className="text-xs text-muted">
                  <span className="font-medium text-ink">{ownerRole.name}</span>{" "}
                  has full access and is read-only.
                </p>
              )}
            </div>
          </Card>

          {isOwnerSelected ? (
            <Card>
              <p className="text-sm text-muted">
                <span className="font-semibold text-ink">Full access.</span> The
                owner role holds every permission and cannot be edited.
              </p>
            </Card>
          ) : (
            <>
              {/* Controls */}
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-ink">
                    Search permissions
                  </label>
                  <Input
                    placeholder="Key or description…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="w-56">
                  <label className="mb-1.5 block text-sm font-medium text-ink">
                    Group
                  </label>
                  <Select
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  >
                    <option value="">All groups</option>
                    {groupNames.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setCollapsed(new Set())}
                  >
                    Expand all
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setCollapsed(new Set(groupNames))}
                  >
                    Collapse all
                  </Button>
                </div>
              </div>

              {/* Unsaved-changes banner */}
              {dirty && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">Unsaved changes</span> ·{" "}
                    {added.length} added, {removed.length} removed
                    {touchesHighRisk && " · touches high-risk permissions"}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setDraft(new Set(original))}
                    >
                      Discard
                    </Button>
                    <Button onClick={() => setShowDiff(true)}>
                      Review &amp; save
                    </Button>
                  </div>
                </div>
              )}

              {/* Permission groups */}
              {filteredGroups.length === 0 ? (
                <EmptyState message="No permissions match your search." />
              ) : (
                <div className="space-y-3">
                  {filteredGroups.map((g) => {
                    const grantedInGroup = g.permissions.filter((p) =>
                      draft.has(p.key)
                    ).length;
                    const expanded = isExpanded(g.group);
                    return (
                      <div
                        key={g.group}
                        className="overflow-hidden rounded-xl border border-line bg-surface"
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.group)}
                          className="flex w-full items-center justify-between gap-3 bg-surface-2 px-4 py-3 text-left"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                            <Icon
                              name={expanded ? "chevronDown" : "chevronRight"}
                              className="h-4 w-4 text-muted"
                            />
                            {g.group}
                          </span>
                          <span className="text-xs text-muted">
                            {grantedInGroup}/{g.permissions.length} granted
                          </span>
                        </button>
                        {expanded && (
                          <ul className="divide-y divide-line">
                            {g.permissions.map((p) => {
                              const checked = draft.has(p.key);
                              const high = isHighRisk(p.key);
                              return (
                                <li key={p.key}>
                                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-2">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggle(p.key)}
                                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-xs text-ink">
                                          {p.key}
                                        </span>
                                        {high && (
                                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                            <Icon
                                              name="alert"
                                              className="h-3.5 w-3.5"
                                            />
                                            <span className="text-[11px] font-semibold uppercase tracking-wide">
                                              high-risk
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                      <span className="mt-0.5 block text-xs text-muted">
                                        {p.description}
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
            </>
          )}
        </>
      )}

      {selectedEntry && !isOwnerSelected && (
        <DiffModal
          open={showDiff}
          roleKey={selectedEntry.key}
          roleName={selectedEntry.name}
          added={added}
          removed={removed}
          touchesHighRisk={touchesHighRisk}
          permissionKeys={[...draft]}
          onClose={() => setShowDiff(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function DiffList({
  title,
  keys,
  tone,
}: {
  title: string;
  keys: string[];
  tone: "green" | "red";
}) {
  if (keys.length === 0) return null;
  const color =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  return (
    <div>
      <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${color}`}>
        {title} ({keys.length})
      </p>
      <ul className="space-y-1">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink">{k}</span>
            {isHighRisk(k) && <Badge tone="amber">high-risk</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffModal({
  open,
  roleKey,
  roleName,
  added,
  removed,
  touchesHighRisk,
  permissionKeys,
  onClose,
  onSaved,
}: {
  open: boolean;
  roleKey: string;
  roleName: string;
  added: string[];
  removed: string[];
  touchesHighRisk: boolean;
  permissionKeys: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const reasonRequired = touchesHighRisk;
  const canSubmit = !reasonRequired || reason.trim().length >= 5;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/platform/rbac/roles/${roleKey}/permissions`, {
        permissionKeys,
        reason: reason.trim() || undefined,
      });
      toast.success(`Permissions saved for ${roleName}`);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Review permission changes" open onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Saving these changes for{" "}
          <span className="font-medium text-ink">{roleName}</span>.
        </p>

        {touchesHighRisk && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            This change touches high-risk permissions. A reason of at least 5
            characters is required and will be recorded in the audit log.
          </div>
        )}

        <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-4">
          <DiffList title="Added" keys={added} tone="green" />
          <DiffList title="Removed" keys={removed} tone="red" />
          {added.length === 0 && removed.length === 0 && (
            <p className="text-sm text-muted">No changes.</p>
          )}
        </div>

        <Field
          label={reasonRequired ? "Reason (required — audited)" : "Reason (optional)"}
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              reasonRequired ? "At least 5 characters" : "Optional note (audited)"
            }
          />
        </Field>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
