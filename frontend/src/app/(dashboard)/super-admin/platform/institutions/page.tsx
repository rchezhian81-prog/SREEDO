"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { PlatformInstitution } from "@/types";
import { usePlatformGuard } from "../_guard";
import { formatNumber } from "../_utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Paged {
  rows: PlatformInstitution[];
  total: number;
  page: number;
  pageSize: number;
}
interface PackageOption {
  id: string;
  name: string;
}

type SortKey = "name" | "code" | "status" | "createdAt" | "students" | "staff" | "package";

export default function PlatformInstitutionsPage() {
  const { ready, gate } = usePlatformGuard("Institutions", "All tenants on the platform");

  const [data, setData] = useState<Paged | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters / paging / sort. `qInput` is the live field; `q` is the debounced,
  // committed value the query actually uses.
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [packageId, setPackageId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    if (type) p.set("type", type);
    if (packageId) p.set("packageId", packageId);
    if (createdFrom) p.set("createdFrom", createdFrom);
    if (createdTo) p.set("createdTo", createdTo);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p;
  }, [q, status, type, packageId, createdFrom, createdTo, page, pageSize, sort, order]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged>(`/platform/institutions?${buildQuery().toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load institutions");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  useEffect(() => {
    if (ready) api.get<PackageOption[]>("/packages").then(setPackages).catch(() => setPackages([]));
  }, [ready]);

  // Real debounce: commit the search field 300ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Reset to page 1 on any filter change.
  useEffect(() => {
    setPage(1);
  }, [q, status, type, packageId, createdFrom, createdTo, pageSize, sort, order]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("asc");
    }
    setPage(1);
  };

  const download = async (format: "csv" | "xlsx") => {
    const token = useAuthStore.getState().accessToken;
    const p = buildQuery();
    p.delete("page");
    p.delete("pageSize");
    p.set("format", format);
    const res = await fetch(`${API_URL}/platform/institutions/export?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Failed to export institutions");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `institutions.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const suspend = (inst: PlatformInstitution) => {
    const reason = window.prompt(`Suspend ${inst.name}? Enter a reason (recorded in the audit log):`);
    if (reason === null) return;
    act(() => api.post(`/platform/institutions/${inst.id}/suspend`, { reason: reason || undefined }));
  };
  const activate = (inst: PlatformInstitution) => {
    if (!window.confirm(`Re-activate ${inst.name}?`)) return;
    act(() => api.post(`/platform/institutions/${inst.id}/activate`));
  };

  if (!ready) return gate;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const sortArrow = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform" className="hover:text-slate-600">
          Platform
        </Link>{" "}
        / <span className="text-slate-600">Institutions</span>
      </nav>

      <PageHeader
        title="Institutions"
        subtitle={`${formatNumber(total)} tenant${total === 1 ? "" : "s"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => download("csv")}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => download("xlsx")}>
              Export XLSX
            </Button>
            <Link href="/super-admin/platform/institutions/new">
              <Button>+ New institution</Button>
            </Link>
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Input placeholder="Search name or code…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="school">School</option>
          <option value="college">College</option>
        </Select>
        <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
          <option value="">All packages</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <span className="shrink-0">Created from</span>
          <Input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <span className="shrink-0">to</span>
          <Input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
        </label>
      </div>

      {error && <ErrorNote message={error} />}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            q || status || type || packageId || createdFrom || createdTo
              ? "No institutions match these filters."
              : "No institutions yet. Create one to get started."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {([
                    ["name", "Name"],
                    ["code", "Code"],
                    ["status", "Status"],
                    ["students", "Students"],
                    ["staff", "Staff"],
                    ["package", "Package"],
                    ["createdAt", "Created"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className="cursor-pointer select-none px-4 py-3 hover:text-slate-700"
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      {sortArrow(key)}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((inst) => (
                  <tr key={inst.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link
                        href={`/super-admin/platform/institutions/${inst.id}`}
                        className="text-brand-600 hover:text-brand-700"
                      >
                        {inst.name}
                      </Link>
                      <span className="ml-2 capitalize text-xs text-slate-400">{inst.type}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{inst.code}</td>
                    <td className="px-4 py-3">
                      <Badge tone={inst.isActive ? "green" : "red"}>
                        {inst.isActive ? "active" : "suspended"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{formatNumber(inst.students)}</td>
                    <td className="px-4 py-3">{formatNumber(inst.staff)}</td>
                    <td className="px-4 py-3">
                      {inst.packageName ? (
                        <Badge tone="blue">{inst.packageName}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{inst.createdAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-3">
                        <Link
                          href={`/super-admin/platform/institutions/${inst.id}`}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Manage
                        </Link>
                        {inst.isActive ? (
                          <button
                            onClick={() => suspend(inst)}
                            disabled={busy}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            onClick={() => activate(inst)}
                            disabled={busy}
                            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-20"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </>
      )}
    </>
  );
}
