"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { PlatformAuditRow, PlatformInstitution } from "@/types";
import { usePlatformGuard } from "../_guard";
import { compactDetail } from "../_utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Paged {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}
type SortKey = "createdAt" | "action" | "actorEmail";

export default function PlatformAuditPage() {
  const { ready, gate } = usePlatformGuard(
    "Platform audit",
    "Durable cross-tenant administrative trail"
  );

  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);
  const [data, setData] = useState<Paged | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformAuditRow | null>(null);

  // Filters / paging / sort
  const [q, setQ] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [ip, setIp] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!ready) return;
    api
      .get<{ rows: PlatformInstitution[] }>("/platform/institutions?pageSize=100&sort=name&order=asc")
      .then((d) => setInstitutions(d.rows))
      .catch(() => undefined);
  }, [ready]);

  // Honour a deep link from the institution detail page (?institutionId=…).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("institutionId");
    if (param) setInstitutionId(param);
  }, []);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (institutionId) p.set("institutionId", institutionId);
    if (action.trim()) p.set("action", action.trim());
    if (targetType.trim()) p.set("targetType", targetType.trim());
    if (ip.trim()) p.set("ip", ip.trim());
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p;
  }, [q, institutionId, action, targetType, ip, dateFrom, dateTo, page, pageSize, sort, order]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paged>(`/platform/audit?${buildQuery().toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // Debounce free-text inputs; reset to page 1 on any filter change.
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(t);
  }, [q, institutionId, action, targetType, ip, dateFrom, dateTo, pageSize, sort, order]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  const download = async (format: "csv" | "xlsx") => {
    const token = useAuthStore.getState().accessToken;
    const p = buildQuery();
    p.delete("page");
    p.delete("pageSize");
    p.set("format", format);
    const res = await fetch(`${API_URL}/platform/audit/export?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Failed to export audit log");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-audit.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
        / <span className="text-slate-600">Audit</span>
      </nav>

      <PageHeader
        title="Platform audit"
        subtitle="Durable cross-tenant administrative trail"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => download("csv")}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => download("xlsx")}>
              Export XLSX
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search action / actor / target / IP…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
            <option value="">All institutions</option>
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.code})
              </option>
            ))}
          </Select>
          <Input placeholder="Action e.g. institution.suspend" value={action} onChange={(e) => setAction(e.target.value)} />
          <Input placeholder="Target type e.g. institution" value={targetType} onChange={(e) => setTargetType(e.target.value)} />
          <Input placeholder="IP address" value={ip} onChange={(e) => setIp(e.target.value)} />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No audit entries for these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="cursor-pointer select-none px-4 py-3 hover:text-slate-700" onClick={() => toggleSort("createdAt")}>
                    Time{sortArrow("createdAt")}
                  </th>
                  <th className="cursor-pointer select-none px-4 py-3 hover:text-slate-700" onClick={() => toggleSort("action")}>
                    Action{sortArrow("action")}
                  </th>
                  <th className="px-4 py-3">Institution</th>
                  <th className="cursor-pointer select-none px-4 py-3 hover:text-slate-700" onClick={() => toggleSort("actorEmail")}>
                    Actor{sortArrow("actorEmail")}
                  </th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer align-top hover:bg-slate-50"
                    onClick={() => setDetail(row)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="blue">{row.action}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.institutionName ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.actorEmail ?? "—"}
                      {row.actorRole && (
                        <span className="block text-xs capitalize text-slate-400">
                          {row.actorRole.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.ip ?? "—"}</td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="block truncate font-mono text-xs text-slate-500">
                        {compactDetail(row.detail)}
                      </span>
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
              <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-20">
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span>
                Page {page} of {totalPages} · {total} total
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

      {/* Detail drawer */}
      <Modal title="Audit event" open={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-2 text-sm">
            <Row label="Time" value={new Date(detail.createdAt).toLocaleString()} />
            <Row label="Action" value={detail.action} />
            <Row label="Actor" value={`${detail.actorEmail ?? "—"} (${detail.actorRole ?? "—"})`} />
            <Row label="Institution" value={detail.institutionName ?? "—"} />
            <Row label="Target type" value={detail.targetType ?? "—"} />
            <Row label="Target ID" value={detail.targetId ?? "—"} mono />
            <Row label="IP" value={detail.ip ?? "—"} mono />
            <div>
              <p className="mb-1 font-medium text-slate-700">Metadata</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
                {JSON.stringify(detail.detail ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 font-medium text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-xs text-slate-700" : "text-slate-700"}>{value}</span>
    </div>
  );
}
