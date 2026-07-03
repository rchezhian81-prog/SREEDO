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
  Input,
  PageHeader,
  Select,
  Spinner,
  cx,
} from "@/components/ui";
import { usePlatformGuard } from "../../platform/_guard";
import {
  WINDOW_OPTIONS,
  downloadSecurityExport,
  formatDateTime,
  roleLabel,
  shortUserAgent,
  type FailedSummary,
  type LoginHistoryRow,
  type Paged,
  type SecurityWindow,
} from "../_security";

export default function LoginHistoryPage() {
  const { ready, gate } = usePlatformGuard(
    "Login history",
    "Sign-in successes, failures & failed-login monitoring"
  );

  const [data, setData] = useState<Paged<LoginHistoryRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [outcome, setOutcome] = useState("");
  const [ip, setIp] = useState("");
  const [debouncedIp, setDebouncedIp] = useState("");
  const [scope, setScope] = useState<"platform" | "all">("platform");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Failed-login summary panel.
  const [summaryBy, setSummaryBy] = useState<"email" | "ip" | "day">("email");
  const [summaryWindow, setSummaryWindow] = useState<SecurityWindow>("7d");
  const [summary, setSummary] = useState<FailedSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedIp(ip), 400);
    return () => clearTimeout(t);
  }, [ip]);

  useEffect(() => {
    setPage(1);
  }, [debounced, outcome, debouncedIp, scope, dateFrom, dateTo]);

  // Shared filter params (without pagination — reused by the export).
  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced.trim()) p.set("q", debounced.trim());
    if (outcome) p.set("outcome", outcome);
    if (debouncedIp.trim()) p.set("ip", debouncedIp.trim());
    p.set("scope", scope);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p;
  }, [debounced, outcome, debouncedIp, scope, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = new URLSearchParams(filterParams);
      p.set("page", String(page));
      p.set("pageSize", "25");
      setData(
        await api.get<Paged<LoginHistoryRow>>(
          `/platform/security/login-history?${p.toString()}`
        )
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load login history");
    } finally {
      setLoading(false);
    }
  }, [filterParams, page]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const loadSummary = useCallback(async () => {
    if (!ready) return;
    setSummaryLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("by", summaryBy);
      p.set("window", summaryWindow);
      setSummary(
        await api.get<FailedSummary>(
          `/platform/security/login-history/summary?${p.toString()}`
        )
      );
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [ready, summaryBy, summaryWindow]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const doExport = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      const p = new URLSearchParams(filterParams);
      p.set("format", format);
      await downloadSecurityExport(
        `/platform/security/login-history/export?${p.toString()}`,
        `login-history.${format}`
      );
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const hasFilters =
    !!debounced || !!outcome || !!debouncedIp || scope !== "platform" || !!dateFrom || !!dateTo;
  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Login history" subtitle="Sign-in successes, failures & failed-login monitoring" />
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
        / <span className="text-muted">Login history</span>
      </nav>
      <PageHeader
        title="Login history"
        subtitle="Sign-in successes, failures & failed-login monitoring"
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("csv")}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button variant="secondary" disabled={exporting} onClick={() => doExport("xlsx")}>
              Export XLSX
            </Button>
          </div>
        }
      />

      {/* Failed-login summary */}
      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Failed login summary</p>
            <p className="text-xs text-muted">
              Grouped failed sign-in attempts over the window.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {(["email", "ip", "day"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setSummaryBy(b)}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
                    summaryBy === b ? "bg-brand-600 text-white" : "text-muted hover:text-ink"
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
            <Select
              value={summaryWindow}
              onChange={(e) => setSummaryWindow(e.target.value as SecurityWindow)}
              className="w-28"
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {summaryLoading ? (
          <Spinner />
        ) : !summary || summary.rows.length === 0 ? (
          <EmptyState message="No failed logins in this window." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2.5 capitalize">{summaryBy}</th>
                  <th className="px-4 py-2.5 text-right">Attempts</th>
                  <th className="px-4 py-2.5 text-right">Distinct IPs</th>
                  <th className="px-4 py-2.5">Last attempt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{r.key}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge tone={r.attempts >= 5 ? "red" : "amber"}>{r.attempts}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted">{r.distinctIps}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {formatDateTime(r.lastAttemptAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">Email</label>
          <Input
            placeholder="Actor email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">Outcome</label>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">IP</label>
          <Input placeholder="IP…" value={ip} onChange={(e) => setIp(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">Scope</label>
          <Select value={scope} onChange={(e) => setScope(e.target.value as "platform" | "all")}>
            <option value="platform">Platform only</option>
            <option value="all">All accounts</option>
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setOutcome("");
              setIp("");
              setScope("platform");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No login events match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-surface-2">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={r.success ? "green" : "red"}>
                        {r.success ? "Success" : "Failed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink">{r.actorEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{roleLabel(r.actorRole)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{r.ip ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{shortUserAgent(r.userAgent)}</td>
                    <td className="max-w-xs px-4 py-3 text-faint">
                      {r.reason ? (
                        <span className="block break-words">{r.reason}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              {data.total} event{data.total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
