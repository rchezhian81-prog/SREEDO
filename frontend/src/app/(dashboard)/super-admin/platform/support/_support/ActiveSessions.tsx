"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorNote, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { SupportSession } from "@/types";
import { useNow } from "@/lib/use-now";
import { RevokeModal } from "./RevokeModal";
import {
  formatCountdown,
  humanizeRole,
  scopeLabel,
  scopeTone,
} from "./taxonomy";

type RevokeTarget =
  | { kind: "session"; id: string; label: string }
  | { kind: "operator"; id: string; label: string }
  | { kind: "tenant"; id: string; label: string };

export function ActiveSessions({
  reloadKey,
  onOpenSession,
  onChanged,
}: {
  reloadKey: number;
  onOpenSession: (id: string) => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const [opId, setOpId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const now = useNow(1000);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<SupportSession[]>("/platform/support/sessions/active"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load active sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // Distinct operators / tenants present in the active set (for the bulk actions).
  const operators = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (r.operatorId) map.set(r.operatorId, r.operatorEmail ?? r.operatorId);
    return [...map.entries()];
  }, [rows]);
  const tenants = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows)
      if (r.institutionId) map.set(r.institutionId, r.institutionName ?? r.institutionCode ?? r.institutionId);
    return [...map.entries()];
  }, [rows]);

  const runRevoke = async (reason: string) => {
    if (!target) return;
    let result: { revoked: number };
    if (target.kind === "session") {
      const r = await api.post<{ revoked: number; alreadyInactive: boolean }>(
        `/platform/support/sessions/${target.id}/revoke`,
        { reason }
      );
      result = r;
    } else if (target.kind === "operator") {
      result = await api.post<{ revoked: number }>("/platform/support/revoke-by-operator", {
        operatorId: target.id,
        reason,
      });
    } else {
      result = await api.post<{ revoked: number }>("/platform/support/revoke-by-tenant", {
        institutionId: target.id,
        reason,
      });
    }
    toast.success(
      result.revoked > 0
        ? `Revoked ${result.revoked} session${result.revoked === 1 ? "" : "s"}.`
        : "No active sessions to revoke."
    );
    await load();
    onChanged();
  };

  return (
    <div className="space-y-4">
      {/* Bulk revoke controls */}
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted">Revoke all for operator</span>
            <Select value={opId} onChange={(e) => setOpId(e.target.value)} disabled={operators.length === 0}>
              <option value="">Select operator…</option>
              {operators.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="danger"
            disabled={!opId}
            onClick={() => {
              const label = operators.find(([id]) => id === opId)?.[1] ?? opId;
              setTarget({ kind: "operator", id: opId, label });
            }}
          >
            Revoke
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted">Revoke all for tenant</span>
            <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} disabled={tenants.length === 0}>
              <option value="">Select tenant…</option>
              {tenants.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="danger"
            disabled={!tenantId}
            onClick={() => {
              const label = tenants.find(([id]) => id === tenantId)?.[1] ?? tenantId;
              setTarget({ kind: "tenant", id: tenantId, label });
            }}
          >
            Revoke
          </Button>
        </div>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No support sessions are active right now." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Operator</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Time left</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => {
                const remaining = s.expiresAt ? new Date(s.expiresAt).getTime() - now : 0;
                return (
                  <tr key={s.id} className="align-top hover:bg-hover">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onOpenSession(s.id)}
                        className="text-left font-medium text-brand-600 hover:text-brand-700"
                      >
                        {s.targetEmail}
                      </button>
                      <span className="block text-xs capitalize text-faint">{humanizeRole(s.targetRole)}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {s.institutionName ?? "—"}
                      {s.institutionCode && <span className="block text-xs text-faint">{s.institutionCode}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{s.operatorEmail ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={scopeTone(s.scope)}>{scopeLabel(s.scope)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`font-mono text-xs font-semibold ${
                          remaining <= 5 * 60_000 ? "text-amber-600" : "text-ink"
                        }`}
                      >
                        {s.expiresAt ? formatCountdown(new Date(s.expiresAt).getTime(), now) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        className="!px-3 !py-1.5"
                        onClick={() => setTarget({ kind: "session", id: s.id, label: s.targetEmail })}
                      >
                        <Icon name="lock" className="h-4 w-4" />
                        Revoke
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RevokeModal
        open={target !== null}
        title={
          target?.kind === "operator"
            ? "Revoke all sessions for operator"
            : target?.kind === "tenant"
              ? "Revoke all sessions for tenant"
              : "Revoke support session"
        }
        description={
          target ? (
            target.kind === "session" ? (
              <>
                Immediately end support access for{" "}
                <span className="font-semibold text-ink">{target.label}</span>. This is audited.
              </>
            ) : (
              <>
                Immediately end <span className="font-semibold text-ink">every active session</span> for{" "}
                {target.kind === "operator" ? "operator" : "tenant"}{" "}
                <span className="font-semibold text-ink">{target.label}</span>. This is audited.
              </>
            )
          ) : null
        }
        confirmLabel={target && target.kind !== "session" ? "Revoke all" : "Revoke access"}
        onConfirm={runRevoke}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
