"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button, EmptyState, ErrorNote, PageHeader, Select, Spinner } from "@/components/ui";
import { usePlatformGuard } from "../../platform/_guard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
const BILLING_CYCLES: [string, string][] = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"], ["annual", "Annual"]];
const cycleLabel = (c: string) => BILLING_CYCLES.find(([v]) => v === c)?.[1] ?? c;

interface Row {
  id: string; name: string; status: string; billingCycle: string; price: string | number; currency: string;
  tenants: number; active: number; trial: number; suspended: number; expired: number;
  students: number; staff: number; revenue: string | number; outstanding: string | number; overdue: string | number;
}

function authToken() { return useAuthStore.getState().accessToken; }
async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function PackageUsageReportPage() {
  const { ready, gate } = usePlatformGuard("Package usage", "Plan adoption & revenue");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [institutionType, setInstitutionType] = useState("");
  const [billingCycle, setBillingCycle] = useState("");
  const [status, setStatus] = useState("");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (institutionType) p.set("institutionType", institutionType);
    if (billingCycle) p.set("billingCycle", billingCycle);
    if (status) p.set("status", status);
    return p;
  }, [institutionType, billingCycle, status]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await api.get<Row[]>(`/packages-report?${buildQuery().toString()}`)); }
    catch (err) { setRows([]); setError(err instanceof ApiError ? err.message : "Failed to load report"); }
    finally { setLoading(false); }
  }, [buildQuery]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const exportReport = (format: "csv" | "xlsx") => {
    const p = buildQuery(); p.set("format", format);
    downloadFile(`/packages-report?${p.toString()}`, `package-usage.${format}`).catch(() => setError("Export failed"));
  };

  if (!ready) return gate;
  const money = (v: string | number) => Number(v).toLocaleString();

  return (
    <>
      <nav className="mb-2 text-xs text-slate-400">
        <Link href="/super-admin/packages" className="hover:text-slate-600">Packages</Link> /{" "}
        <span className="text-slate-600">Usage report</span>
      </nav>
      <PageHeader
        title="Package usage report"
        subtitle="Tenants by status, usage and revenue per package"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => exportReport("csv")}>Export CSV</Button>
            <Button variant="secondary" onClick={() => exportReport("xlsx")}>Export XLSX</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Select value={institutionType} onChange={(e) => setInstitutionType(e.target.value)}>
          <option value="">All institution types</option>
          {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </Select>
        <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
          <option value="">All billing cycles</option>
          {BILLING_CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All package statuses</option>
          {["active", "draft", "deprecated", "archived"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>

      {error && <ErrorNote message={error} />}
      {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No packages match." /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Package</th><th className="px-4 py-3">Tenants</th><th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Trial</th><th className="px-4 py-3">Susp.</th><th className="px-4 py-3">Exp.</th>
                <th className="px-4 py-3">Students</th><th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Revenue</th><th className="px-4 py-3">Outstanding</th><th className="px-4 py-3">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/super-admin/packages/${r.id}`} className="text-brand-600 hover:text-brand-700">{r.name}</Link>
                    <div className="text-xs text-slate-400">{r.status} · {cycleLabel(r.billingCycle)}</div>
                  </td>
                  <td className="px-4 py-3">{r.tenants}</td><td className="px-4 py-3">{r.active}</td>
                  <td className="px-4 py-3">{r.trial}</td><td className="px-4 py-3">{r.suspended}</td><td className="px-4 py-3">{r.expired}</td>
                  <td className="px-4 py-3">{r.students}</td><td className="px-4 py-3">{r.staff}</td>
                  <td className="px-4 py-3">{r.currency} {money(r.revenue)}</td>
                  <td className="px-4 py-3">{money(r.outstanding)}</td>
                  <td className="px-4 py-3 text-red-600">{money(r.overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
