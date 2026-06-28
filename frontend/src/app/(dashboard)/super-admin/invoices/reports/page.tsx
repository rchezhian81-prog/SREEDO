"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { formatMoney } from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Column { key: string; label: string; numeric?: boolean }
interface ReportResult {
  type: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown> | null;
}
interface InstitutionBrief { id: string; name: string; code: string }

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "all", label: "All invoices" },
  { value: "paid", label: "Paid invoices" },
  { value: "unpaid", label: "Unpaid / outstanding" },
  { value: "overdue", label: "Overdue invoices" },
  { value: "draft", label: "Draft invoices" },
  { value: "void", label: "Void invoices" },
  { value: "by-institution", label: "Institution-wise" },
  { value: "by-month", label: "Month-wise" },
  { value: "revenue", label: "Revenue summary" },
  { value: "tax", label: "Flat tax summary" },
];

// Numeric columns that are money (formatted as currency) vs plain counts/percent.
const PLAIN_NUMERIC = new Set(["count", "taxPercent"]);

export default function InvoiceReportsPage() {
  const router = useRouter();
  const [type, setType] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [institutions, setInstitutions] = useState<InstitutionBrief[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<InstitutionBrief[]>("/platform/institutions").then(setInstitutions).catch(() => {});
  }, []);

  const queryString = useCallback(() => {
    const p = new URLSearchParams({ type });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (institutionId) p.set("institutionId", institutionId);
    return p.toString();
  }, [type, from, to, institutionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<ReportResult>(`/platform/invoices/reports?${queryString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  const exportReport = async (format: "csv" | "xlsx") => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/invoices/reports?${queryString()}&format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Export failed");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice-report-${type}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  const fmt = (c: Column, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (c.numeric && !PLAIN_NUMERIC.has(c.key)) return formatMoney(v as string);
    return String(v);
  };

  return (
    <>
      <PageHeader
        title="Invoice reports"
        subtitle="Register, outstanding, overdue, collection, revenue and flat-tax summaries"
        action={
          <Button variant="secondary" onClick={() => router.push("/super-admin/invoices")}>
            ← Invoices
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Field label="Report">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {REPORT_TYPES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-52">
          <Field label="Institution">
            <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
              <option value="">All institutions</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({i.code})</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportReport("csv")} disabled={!result?.rows.length}>
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => exportReport("xlsx")} disabled={!result?.rows.length}>
            Export Excel
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !result || result.rows.length === 0 ? (
        <EmptyState message="No data for this report and filter range" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                {result.columns.map((c) => (
                  <th key={c.key} className={`px-4 py-3 ${c.numeric ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-2">
                  {result.columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2.5 ${c.numeric ? "text-right text-ink" : "text-muted"}`}>
                      {fmt(c, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {result.totals && (
              <tfoot className="border-t-2 border-line bg-surface-2 font-semibold text-ink">
                <tr>
                  {result.columns.map((c, idx) => (
                    <td key={c.key} className={`px-4 py-3 ${c.numeric ? "text-right" : ""}`}>
                      {idx === 0
                        ? "TOTAL"
                        : c.key in (result.totals as Record<string, unknown>)
                          ? fmt(c, (result.totals as Record<string, unknown>)[c.key])
                          : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}
