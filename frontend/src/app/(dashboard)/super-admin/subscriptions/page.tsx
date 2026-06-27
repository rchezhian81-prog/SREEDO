"use client";

import { useCallback, useEffect, useState } from "react";
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

// Inline types mirror the read-only B1 platform endpoints
// (/platform/subscriptions, /platform/subscriptions/config,
//  /platform/institutions/:id/subscription/events).
interface LifecycleConfig {
  autoSuspend: boolean;
  enforce: boolean;
  graceDays: number;
  reminderDays: number[];
}

interface SubscriptionRow {
  institutionId: string;
  institutionName: string;
  code: string;
  institutionActive: boolean;
  status: string | null;
  packageName: string | null;
  endsAt: string | null;
  graceUntil: string | null;
  trialEndsAt: string | null;
  isActiveNow: boolean;
}

interface SweepSummary {
  graceStarted: number;
  expired: number;
  trialExpired: number;
  autoSuspended: number;
  remindersSent: number;
  ranAt: string;
}

interface SubscriptionEvent {
  id: string;
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorEmail: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

type Tone = "slate" | "green" | "amber" | "red" | "blue";

function statusTone(status: string | null): Tone {
  switch (status) {
    case "active":
      return "green";
    case "trialing":
      return "blue";
    case "expired":
    case "suspended":
      return "red";
    default:
      return "slate";
  }
}

function statusLabel(status: string | null): string {
  if (!status) return "none";
  return status === "trialing" ? "trial" : status;
}

/** Term has lapsed but the subscription is still within its grace window. */
function inGrace(row: SubscriptionRow): boolean {
  return (
    !!row.graceUntil && (row.status === "active" || row.status === "trialing")
  );
}

export default function SubscriptionsPage() {
  const [config, setConfig] = useState<LifecycleConfig | null>(null);
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<SweepSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SubscriptionRow | null>(null);
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, list] = await Promise.all([
        api.get<LifecycleConfig>("/platform/subscriptions/config"),
        api.get<SubscriptionRow[]>("/platform/subscriptions"),
      ]);
      setConfig(cfg);
      setRows(list);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscriptions"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runLifecycle = async () => {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const summary = await api.post<SweepSummary>(
        "/platform/subscriptions/run-lifecycle"
      );
      setRunResult(summary);
      await load();
    } catch (err) {
      setRunError(
        err instanceof ApiError ? err.message : "Failed to run lifecycle"
      );
    } finally {
      setRunning(false);
    }
  };

  const viewEvents = async (row: SubscriptionRow) => {
    setSelected(row);
    setEvents([]);
    setEventsError(null);
    setEventsLoading(true);
    try {
      setEvents(
        await api.get<SubscriptionEvent[]>(
          `/platform/institutions/${row.institutionId}/subscription/events`
        )
      );
    } catch (err) {
      setEventsError(
        err instanceof ApiError ? err.message : "Failed to load events"
      );
    } finally {
      setEventsLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Tenant subscription lifecycle — status, events & manual run (super-admin)"
        action={
          <Button onClick={runLifecycle} disabled={running}>
            {running ? "Running…" : "Run lifecycle now"}
          </Button>
        }
      />

      {config && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-ink">Lifecycle settings:</span>
            <Badge tone={config.autoSuspend ? "red" : "slate"}>
              auto-suspend {config.autoSuspend ? "ON" : "OFF"}
            </Badge>
            <Badge tone={config.enforce ? "red" : "slate"}>
              enforcement {config.enforce ? "ON" : "OFF"}
            </Badge>
            <Badge tone="blue">grace {config.graceDays}d</Badge>
            <Badge tone="blue">
              reminders{" "}
              {config.reminderDays.length
                ? `${config.reminderDays.join("/")}d`
                : "off"}
            </Badge>
          </div>
          {config.autoSuspend || config.enforce ? (
            <p className="mt-2 text-xs font-medium text-red-600">
              ⚠️{" "}
              {config.autoSuspend &&
                "Auto-suspend is ON — expired tenants will be deactivated. "}
              {config.enforce &&
                "Enforcement is ON — lapsed tenants are blocked from writes."}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Auto-suspend and enforcement are OFF (defaults). Running the
              lifecycle only updates statuses and queues renewal reminders — no
              tenant is suspended or blocked.
            </p>
          )}
        </Card>
      )}

      {runError && <ErrorNote message={runError} />}
      {runResult && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            Lifecycle run complete
          </p>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-200">
            grace started {runResult.graceStarted} · expired {runResult.expired}{" "}
            · trials expired {runResult.trialExpired} · auto-suspended{" "}
            {runResult.autoSuspended} · reminders sent {runResult.remindersSent}
          </p>
        </Card>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No institutions found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ends</th>
                <th className="px-4 py-3">Active now</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.institutionId} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.institutionName}
                    <span className="block text-xs text-faint">{row.code}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {row.packageName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(row.status)}>
                        {statusLabel(row.status)}
                      </Badge>
                      {inGrace(row) && <Badge tone="amber">in grace</Badge>}
                      {!row.institutionActive && (
                        <Badge tone="red">inst. suspended</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{row.endsAt ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={row.isActiveNow ? "green" : "slate"}>
                      {row.isActiveNow ? "yes" : "no"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => viewEvents(row)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                    >
                      View events
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Card className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">
              Lifecycle events — {selected.institutionName}
            </h2>
            <button
              onClick={() => setSelected(null)}
              className="text-xs font-medium text-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          {eventsLoading ? (
            <Spinner />
          ) : eventsError ? (
            <ErrorNote message={eventsError} />
          ) : events.length === 0 ? (
            <EmptyState message="No lifecycle events recorded yet" />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {events.map((ev) => (
                <li key={ev.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{ev.event}</span>
                    <span className="text-xs text-faint">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {ev.fromStatus && ev.toStatus
                      ? `${ev.fromStatus} → ${ev.toStatus}`
                      : ""}
                    {ev.actorEmail ? ` · by ${ev.actorEmail}` : " · system"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
