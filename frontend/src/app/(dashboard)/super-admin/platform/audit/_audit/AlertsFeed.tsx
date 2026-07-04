"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { AuditAlert, AuditSummary } from "@/types";
import {
  formatDateTime,
  severityLabel,
  severityTone,
} from "./taxonomy";

/**
 * Read-only suspicious-activity feed. Purely informational — NO notifications.
 * Each alert links to the concrete audit row that triggered it (auditId), which
 * opens the shared detail drawer.
 */
export function AlertsFeed({
  window,
  from,
  to,
  onOpenEvent,
}: {
  window: AuditSummary["window"];
  from: string;
  to: string;
  onOpenEvent: (id: string) => void;
}) {
  const [alerts, setAlerts] = useState<AuditAlert[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ window });
      if (window === "custom") {
        if (from) p.set("dateFrom", from);
        if (to) p.set("dateTo", to);
      }
      const res = await api.get<{ alerts: AuditAlert[] }>(
        `/platform/audit/alerts?${p.toString()}`
      );
      setAlerts(res.alerts);
    } catch (err) {
      setAlerts(null);
      setError(err instanceof ApiError ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [window, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Suspicious activity
        </h2>
        <span className="text-xs text-slate-400">display only — no notifications</span>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : alerts && alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((a) => (
            <button
              key={a.key}
              onClick={() => a.auditId && onOpenEvent(a.auditId)}
              className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
            >
              <span className="mt-0.5">
                <Icon
                  name="alert"
                  className={`h-5 w-5 ${
                    severityTone(a.severity) === "red"
                      ? "text-red-500"
                      : severityTone(a.severity) === "amber"
                        ? "text-amber-500"
                        : "text-slate-400"
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{a.title}</span>
                  <Badge tone={severityTone(a.severity)}>
                    {severityLabel(a.severity)}
                  </Badge>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    {a.count} event{a.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  {a.description}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span className="font-mono">{a.action}</span>
                  {a.actorEmail && <span>{a.actorEmail}</span>}
                  <span>Last: {formatDateTime(a.lastAt)}</span>
                </span>
              </span>
              <Icon name="chevronRight" className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      ) : (
        !error && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
            No suspicious activity detected in this window.
          </div>
        )
      )}
    </section>
  );
}
