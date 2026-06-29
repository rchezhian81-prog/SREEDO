"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Badge, Button, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { usePlatformGuard } from "../_guard";
import { formatNumber } from "../_utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface TenantRow {
  id: string;
  name: string;
  code: string;
  type: "school" | "college";
  institutionType: string;
  status: string;
  isActive: boolean;
  slug: string | null;
  students: number;
  staff: number;
  packageName: string | null;
  createdAt: string;
}
interface Paged {
  rows: TenantRow[];
  total: number;
  page: number;
  pageSize: number;
}
type SortKey = "name" | "code" | "status" | "institutionType" | "createdAt" | "students" | "staff";

const statusTone = (s: string) =>
  s === "active" ? "green" : s === "trial" ? "blue" : s === "suspended" || s === "expired" ? "red" : s === "archived" ? "slate" : "amber";

export default function TenantsPage() {
  const { ready, gate } = usePlatformGuard("Tenants", "Institution / tenant management");
  const [data, setData] = useState<Paged | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [status, setStatus] = useState("");
  const [pkg, setPkg] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (institutionType) p.set("institutionType", institutionType);
    if (status) p.set("status", status);
    if (pkg.trim()) p.set("package", pkg.trim());
    if (createdFrom) p.set("createdFrom", createdFrom);
    if (createdTo) p.set("createdTo", createdTo);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p;
  }, [q, institutionType, status, pkg, createdFrom, createdTo, page, pageSize, sort, order]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged>(`/platform/tenants?${buildQuery().toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => {
    setPage(1);
  }, [q, institutionType, status, pkg, createdFrom, createdTo, pageSize, sort, order]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(key); setOrder("asc"); }
  };

  const download = async (format: "csv" | "xlsx") => {
    const token = useAuthStore.getState().accessToken;
    const p = buildQuery();
    p.delete("page"); p.delete("pageSize"); p.set("format", format);
    const res = await fetch(`${API_URL}/platform/tenants/export?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError("Failed to export tenants"); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `tenants.${format}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (!ready) return gate;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const arrow = (k: SortKey) => (sort === k ? (order === "asc" ? " ↑" : " ↓") : "");

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/platform" className="hover:text-slate-600">Platform</Link> /{" "}
        <span className="text-slate-600">Tenants</span>
      </nav>
      <PageHeader
        title="Tenants"
        subtitle={`${formatNumber(total)} institution${total === 1 ? "" : "s"} · one common module for school / college / university / coaching`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => download("csv")}>Export CSV</Button>
            <Button variant="secondary" onClick={() => download("xlsx")}>Export XLSX</Button>
            <Link href="/super-admin/platform/tenants/new"><Button>+ New tenant</Button></Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Input placeholder="Search name / code / email / slug…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Select value={institutionType} onChange={(e) => setInstitutionType(e.target.value)}>
          <option value="">All types</option>
          {["school", "college", "university", "coaching", "other"].map((t) => (
            <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["draft", "trial", "active", "suspended", "expired", "archived", "closed"].map((s) => (
            <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </Select>
        <Input placeholder="Package name…" value={pkg} onChange={(e) => setPkg(e.target.value)} />
        <Input type="date" title="Created from" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
        <Input type="date" title="Created to" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
      </div>

      {error && <ErrorNote message={error} />}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message={q || institutionType || status ? "No tenants match these filters." : "No tenants yet. Create one to get started."} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {([["name", "Name"], ["code", "Code"], ["institutionType", "Type"], ["status", "Status"], ["students", "Students"], ["staff", "Staff"], ["createdAt", "Created"]] as [SortKey, string][]).map(([k, l]) => (
                    <th key={k} className="cursor-pointer select-none px-4 py-3 hover:text-slate-700" onClick={() => toggleSort(k)}>{l}{arrow(k)}</th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/super-admin/platform/tenants/${t.id}`} className="text-brand-600 hover:text-brand-700">{t.name}</Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{t.code}</td>
                    <td className="px-4 py-3 capitalize">{t.institutionType}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                    <td className="px-4 py-3">{formatNumber(t.students)}</td>
                    <td className="px-4 py-3">{formatNumber(t.staff)}</td>
                    <td className="px-4 py-3 text-slate-500">{t.createdAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/super-admin/platform/tenants/${t.id}`} className="text-xs font-medium text-brand-600 hover:text-brand-700">Manage</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-20">
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span>Page {page} of {totalPages} · {formatNumber(total)} total</span>
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>← Prev</Button>
              <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next →</Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
