"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { Icon } from "@/components/icons";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import { IpAllowlistToggleModal } from "../_modals";
import {
  formatDateTime,
  type IpAllowlistEntry,
  type IpAllowlistState,
} from "../_security";

export default function IpAllowlistPage() {
  const { ready, gate } = usePlatformGuard(
    "IP allowlist",
    "Restrict sensitive platform actions to allowed IPs"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [state, setState] = useState<IpAllowlistState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<IpAllowlistEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showToggle, setShowToggle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setState(await api.get<IpAllowlistState>("/platform/security/ip-allowlist"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load allowlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const addEntry = async () => {
    if (!cidr.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const next = await api.post<IpAllowlistState>("/platform/security/ip-allowlist", {
        cidr: cidr.trim(),
        label: label.trim() || undefined,
      });
      setState(next);
      setCidr("");
      setLabel("");
      toast.success("Allowlist entry added");
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to add entry");
    } finally {
      setAdding(false);
    }
  };

  const removeEntry = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const next = await api.delete<IpAllowlistState>(
        `/platform/security/ip-allowlist/${removeTarget.id}`
      );
      setState(next);
      toast.success("Allowlist entry removed");
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove entry");
    } finally {
      setRemoving(false);
    }
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="IP allowlist" subtitle="Restrict sensitive platform actions to allowed IPs" />
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
        / <span className="text-muted">IP allowlist</span>
      </nav>
      <PageHeader
        title="IP allowlist"
        subtitle="Restrict sensitive platform actions to allowed IPs"
        action={
          state && (
            <div className="flex items-center gap-2">
              <Badge tone={state.enabled ? "green" : "slate"}>
                {state.enabled ? "Enforced" : "Off"}
              </Badge>
              {canManage && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.enabled}
                  onClick={() => setShowToggle(true)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                    state.enabled ? "bg-brand-600" : "bg-hover"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      state.enabled ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              )}
            </div>
          )
        }
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !state ? null : (
        <div className="space-y-6">
          {/* High-risk warning */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <span className="font-semibold">High-risk, off by default.</span> When
            enabled, sensitive platform mutations are blocked from any IP not on
            this list. Always add your own IP before enabling, or you will be
            locked out. The allowlist controls themselves are never IP-gated, so
            there is always a recovery path.
          </div>

          {/* Current IP */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                  <Icon name="network" className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Your current IP:{" "}
                    <span className="font-mono">{state.currentIp ?? "unknown"}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {state.enabled
                      ? "Allowlist enforcement is active."
                      : "Allowlist enforcement is currently off."}
                  </p>
                </div>
              </div>
              <Badge tone={state.currentAllowed ? "green" : "red"}>
                {state.currentAllowed ? "On the allowlist" : "Not on the allowlist"}
              </Badge>
            </div>
          </Card>

          {/* Add entry */}
          {canManage && (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">Add an entry</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <Field label="IP address or CIDR" hint="e.g. 203.0.113.10 or 203.0.113.0/24">
                    <Input
                      value={cidr}
                      onChange={(e) => setCidr(e.target.value)}
                      placeholder="203.0.113.0/24"
                    />
                  </Field>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <Field label="Label (optional)">
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Office VPN"
                    />
                  </Field>
                </div>
                <Button onClick={addEntry} disabled={adding || !cidr.trim()}>
                  {adding ? "Adding…" : "Add"}
                </Button>
              </div>
              <ErrorNote message={addError} />
            </Card>
          )}

          {/* Entries */}
          {state.entries.length === 0 ? (
            <EmptyState message="No allowlist entries yet." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3">IP / CIDR</th>
                    <th className="px-4 py-3">Label</th>
                    <th className="px-4 py-3">Added by</th>
                    <th className="px-4 py-3">Added</th>
                    {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {state.entries.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3 font-mono text-xs text-ink">{e.cidr}</td>
                      <td className="px-4 py-3 text-muted">{e.label || "—"}</td>
                      <td className="px-4 py-3 text-faint">{e.createdByEmail ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {formatDateTime(e.createdAt)}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" onClick={() => setRemoveTarget(e)}>
                            Remove
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove allowlist entry"
        message={
          removeTarget
            ? `Remove ${removeTarget.cidr} from the allowlist? If enforcement is on, this could lock out anyone relying on it.`
            : ""
        }
        confirmLabel="Remove"
        busy={removing}
        onConfirm={removeEntry}
        onClose={() => setRemoveTarget(null)}
      />

      {state && (
        <IpAllowlistToggleModal
          open={showToggle}
          enabling={!state.enabled}
          currentIp={state.currentIp}
          currentAllowed={state.currentAllowed}
          onClose={() => setShowToggle(false)}
          onSaved={setState}
        />
      )}
    </>
  );
}
