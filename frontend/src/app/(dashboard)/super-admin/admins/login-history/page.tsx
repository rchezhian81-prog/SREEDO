"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { usePlatformGuard } from "../../platform/_guard";
import {
  formatDateTime,
  shortUserAgent,
  type LoginEvent,
  type Paged,
} from "../_admins";

export default function LoginHistoryPage() {
  const { ready, gate } = usePlatformGuard(
    "Login history",
    "Platform-team sign-in activity — successful & failed attempts"
  );

  const [data, setData] = useState<Paged<LoginEvent>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [outcome, setOutcome] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, outcome, dateFrom, dateTo, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
      if (outcome) p.set("outcome", outcome);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      setData(
        await api.get<Paged<LoginEvent>>(
          `/platform/admins/login-history?${p.toString()}`
        )
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load login history"
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, outcome, dateFrom, dateTo, page, pageSize]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));
  const hasFilters =
    !!debouncedSearch || !!outcome || !!dateFrom || !!dateTo;

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/admins" className="hover:text-muted">
          Platform Admins
        </Link>{" "}
        / <span className="text-muted">Login history</span>
      </nav>
      <PageHeader
        title="Login history"
        subtitle="Platform-team sign-in activity — successful & failed attempts"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Search email
          </label>
          <input
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="admin@company.com"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Outcome
          </label>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All outcomes</option>
            <option value="success">Successful</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            From
          </label>
          <input
            type="date"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">To</label>
          <input
            type="date"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setOutcome("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          message={
            hasFilters
              ? "No login events match these filters"
              : "No login events recorded yet"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Device</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 text-muted">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {e.actorEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.success ? "green" : "red"}>
                        {e.success ? "success" : "failed"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{e.ip ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">
                      {shortUserAgent(e.userAgent)}
                    </td>
                    <td className="px-4 py-3 text-faint">{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>
                {data.total} event{data.total === 1 ? "" : "s"}
              </span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-28"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </Select>
            </div>
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
