"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { JobAlert, JobAlertListResult } from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  alertStatusTone,
  formatDateTime,
  humanizeToken,
  severityTone,
  titleCase,
} from "./taxonomy";

const PAGE_SIZE = 50;

export function AlertsTab({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JobAlertListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [action, setAction] = useState<JobAlert | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, severity]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (severity) p.set("severity", severity);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [status, severity, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<JobAlertListResult>(`/jobs-ops/alerts?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load job alerts");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="bell" className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Job alerts</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {ALERT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">All severities</option>
          {ALERT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No job alerts match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3 text-right">Value / threshold</th>
                  <th className="px-4 py-3">Triggered</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-hover">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{a.ruleName}</span>
                      <span className="block text-xs text-faint">{humanizeToken(a.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{a.service ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {a.metricValue == null ? "—" : formatNumber(a.metricValue)}
                      {a.threshold != null && <span className="text-faint"> / {formatNumber(a.threshold)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(a.triggeredAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setAction(a)}>
                          Manage
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <Icon name="chevronLeft" className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <AlertActionModal alert={action} onClose={() => setAction(null)} onChanged={refresh} />
    </section>
  );
}

type AlertView = "menu" | "ack" | "resolve";

function AlertActionModal({
  alert,
  onClose,
  onChanged,
}: {
  alert: JobAlert | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<AlertView>("menu");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alert) {
      setView("menu");
      setNote("");
      setBusy(false);
      setError(null);
    }
  }, [alert]);

  if (!alert) return null;
  const a = alert;

  const run = async (path: string, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, note.trim() ? { note: note.trim() } : {});
      toast.success(ok);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
      setBusy(false);
    }
  };

  const ack = () => run(`/jobs-ops/alerts/${a.id}/ack`, "Alert acknowledged.");
  const resolve = () => run(`/jobs-ops/alerts/${a.id}/resolve`, "Alert resolved.");

  const canAck = a.status === "triggered" || a.status === "suppressed";
  const canResolve = a.status !== "resolved";

  const title = view === "ack" ? "Acknowledge alert" : view === "resolve" ? "Resolve alert" : a.ruleName;

  return (
    <Modal title={title} open={alert !== null} onClose={onClose}>
      {view === "menu" ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(a.severity)}>{titleCase(a.severity)}</Badge>
            <Badge tone={alertStatusTone(a.status)}>{titleCase(a.status)}</Badge>
            <span className="text-muted">{humanizeToken(a.type)}</span>
            {a.service && <span className="text-faint">· {a.service}</span>}
          </div>
          <dl className="space-y-2">
            <Row label="Metric" value={a.metricValue == null ? "—" : formatNumber(a.metricValue)} />
            <Row label="Threshold" value={a.threshold == null ? "—" : formatNumber(a.threshold)} />
            <Row label="Triggered" value={formatDateTime(a.triggeredAt)} />
            <Row label="Acknowledged" value={formatDateTime(a.acknowledgedAt)} />
            <Row label="Resolved" value={formatDateTime(a.resolvedAt)} />
            {a.note && <Row label="Note" value={a.note} />}
          </dl>
          <ErrorNote message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {canAck && (
              <Button variant="secondary" onClick={() => setView("ack")} disabled={busy}>
                Acknowledge
              </Button>
            )}
            {canResolve && (
              <Button onClick={() => setView("resolve")} disabled={busy}>
                Resolve
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Field label="Note (optional)">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context (optional)…" />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={view === "ack" ? ack : resolve} disabled={busy}>
              {busy ? "Working…" : view === "ack" ? "Acknowledge" : "Resolve"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
