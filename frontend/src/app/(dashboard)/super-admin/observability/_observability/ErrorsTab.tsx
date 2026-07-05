"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import type { ErrorEvent, ErrorListResult, ErrorSummary, ErrorTriageStatus } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { StatCard } from "./OverviewTab";
import {
  ERROR_TRIAGE_STATUSES,
  errorStatusTone,
  formatDateTime,
  statusClassTone,
  titleCase,
} from "./taxonomy";

type Win = "today" | "24h" | "7d" | "30d";
const WINDOWS: Win[] = ["today", "24h", "7d", "30d"];
const WINDOW_LABEL: Record<Win, string> = { today: "Today", "24h": "24h", "7d": "7 days", "30d": "30 days" };

export function ErrorsTab({ reloadKey }: { reloadKey: number }) {
  const [win, setWin] = useState<Win>("24h");
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [route, setRoute] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ route: "", statusCode: "", status: "", q: "" });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<ErrorListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await api.get<ErrorSummary>(`/observability/errors/summary?window=${win}`));
    } catch (err) {
      setSummary(null);
      setSummaryError(err instanceof ApiError ? err.message : "Failed to load error summary");
    }
  }, [win]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary, reloadKey, localReload]);

  useEffect(() => {
    const t = setTimeout(() => setApplied({ route, statusCode, status, q }), 300);
    return () => clearTimeout(t);
  }, [route, statusCode, status, q]);
  useEffect(() => {
    setPage(1);
  }, [applied]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.route.trim()) p.set("route", applied.route.trim());
    if (applied.statusCode.trim()) p.set("statusCode", applied.statusCode.trim());
    if (applied.status) p.set("status", applied.status);
    if (applied.q.trim()) p.set("q", applied.q.trim());
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ErrorListResult>(`/observability/errors?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load errors");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => setLocalReload((k) => k + 1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const anyFilter = route !== "" || statusCode !== "" || status !== "" || q !== "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Error explorer</h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${
                win === w ? "bg-brand-600 text-white" : "bg-surface text-muted hover:bg-hover"
              }`}
            >
              {WINDOW_LABEL[w]}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote message={summaryError} />

      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Distinct errors" value={formatNumber(summary.totals.distinctErrors)} />
            <StatCard label="Occurrences" value={formatNumber(summary.totals.totalOccurrences)} />
            <StatCard
              label="Server errors (5xx)"
              value={formatNumber(summary.totals.serverErrors)}
              tone={summary.totals.serverErrors > 0 ? "red" : undefined}
            />
            <StatCard
              label="Client errors (4xx)"
              value={formatNumber(summary.totals.clientErrors)}
              tone={summary.totals.clientErrors > 0 ? "amber" : undefined}
            />
            <StatCard label="New" value={formatNumber(summary.totals.new)} tone={summary.totals.new > 0 ? "amber" : undefined} />
            <StatCard label="Investigating" value={formatNumber(summary.totals.investigating)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-0">
              <div className="border-b border-line px-5 py-3">
                <p className="text-sm font-semibold text-ink">Top routes</p>
              </div>
              {summary.byRoute.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No errors in this window.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {summary.byRoute.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span className="truncate font-mono text-xs text-ink" title={r.route}>
                        {r.route}
                      </span>
                      <span className="shrink-0 text-muted">
                        {formatNumber(r.occurrences)}{" "}
                        <span className="text-faint">({formatNumber(r.distinct)} distinct)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <p className="mb-3 text-sm font-semibold text-ink">By status class</p>
              {summary.byStatusClass.length === 0 ? (
                <p className="text-sm text-muted">No errors in this window.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {summary.byStatusClass.map((c) => (
                    <div
                      key={c.statusClass}
                      className="rounded-lg border border-line bg-surface-2 px-3 py-2"
                    >
                      <Badge tone={statusClassTone(c.statusClass)}>{c.statusClass}</Badge>
                      <p className="mt-1 text-lg font-semibold text-ink">
                        {formatNumber(c.occurrences)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Filters */}
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input placeholder="Route contains…" value={route} onChange={(e) => setRoute(e.target.value)} aria-label="Route" />
        <Input
          placeholder="Status code"
          value={statusCode}
          onChange={(e) => setStatusCode(e.target.value)}
          aria-label="Status code"
          type="number"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Triage status">
          <option value="">All triage states</option>
          {ERROR_TRIAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Input placeholder="Search message / route…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={anyFilter ? "No errors match these filters." : "No errors captured yet."} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Route</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3">Triage</th>
                  <th className="px-4 py-3">Last seen</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-hover">
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-ink">
                        {r.method} {r.route}
                      </span>
                      {r.errorType && <span className="block text-xs text-faint">{r.errorType}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusClassTone(`${Math.floor(r.statusCode / 100)}xx`)}>
                        {r.statusCode}
                      </Badge>
                    </td>
                    <td className="max-w-md px-4 py-3 text-muted">
                      <span className="block truncate" title={r.message ?? undefined}>
                        {r.message ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {formatNumber(r.count)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={errorStatusTone(r.status)}>{titleCase(r.status)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(r.lastSeen)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5"
                          onClick={() => setDetailId(r.id)}
                        >
                          Triage
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
              ← Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next →
            </Button>
          </div>
        </>
      )}

      <ErrorDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refreshAll} />
    </div>
  );
}

function ErrorDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<ErrorEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triage, setTriage] = useState<ErrorTriageStatus>("new");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setRow(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNote("");
    setRow(null);
    api
      .get<ErrorEvent>(`/observability/errors/${id}`)
      .then((r) => {
        setRow(r);
        setTriage(r.status);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load error"))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) return null;

  const save = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<ErrorEvent>(`/observability/errors/${row.id}`, {
        status: triage,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setRow(updated);
      setNote("");
      toast.success("Error triaged.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to triage error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Error detail" open={id !== null} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !row ? (
        <ErrorNote message={error ?? "Error not found."} />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusClassTone(`${Math.floor(row.statusCode / 100)}xx`)}>
              {row.statusCode}
            </Badge>
            <Badge tone={errorStatusTone(row.status)}>{titleCase(row.status)}</Badge>
            <span className="text-muted">
              {formatNumber(row.count)} occurrence{row.count === 1 ? "" : "s"}
            </span>
          </div>
          <dl className="space-y-2">
            <DRow label="Route" value={<span className="font-mono text-xs">{row.method} {row.route}</span>} />
            <DRow label="Type" value={row.errorType || "—"} />
            <DRow label="Fingerprint" value={<span className="font-mono text-xs">{row.fingerprint}</span>} />
            <DRow label="First seen" value={formatDateTime(row.firstSeen)} />
            <DRow label="Last seen" value={formatDateTime(row.lastSeen)} />
          </dl>
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="mb-1 text-xs font-semibold text-muted">Message (masked)</p>
            <p className="whitespace-pre-wrap break-words text-xs text-ink">{row.message ?? "—"}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Triage status">
              <Select value={triage} onChange={(e) => setTriage(e.target.value as ErrorTriageStatus)}>
                {ERROR_TRIAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Triage note…" />
            </Field>
          </div>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save triage"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
