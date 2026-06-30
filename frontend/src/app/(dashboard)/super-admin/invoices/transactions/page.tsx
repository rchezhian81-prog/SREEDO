"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { formatMoney } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Column { key: string; label: string; numeric?: boolean }
interface TxnResult {
  columns: Column[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown> | null;
}

const STATUSES = ["", "created", "pending", "paid", "failed", "cancelled", "expired", "refunded"];
const statusTone = (s: string): "green" | "amber" | "red" | "slate" =>
  s === "paid" ? "green" : s === "failed" || s === "cancelled" || s === "expired" ? "red" : s === "pending" || s === "created" ? "amber" : "slate";

export default function PaymentTransactionsPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<TxnResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    return p.toString();
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.get<TxnResult>(`/platform/payment-transactions?${queryString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  const exportTxns = async (format: "csv" | "xlsx") => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/payment-transactions?${queryString()}&format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Export failed");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `saas-payment-transactions.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  const fmt = (c: Column, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (c.numeric) return formatMoney(v as string);
    return String(v);
  };

  return (
    <>
      <PageHeader
        title="Payment transactions"
        subtitle="Razorpay online payments for SaaS invoices — super-admin"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/super-admin/invoices/payment-gateway")}>
              Gateway
            </Button>
            <Button variant="secondary" onClick={() => router.push("/super-admin/invoices")}>
              ← Back
            </Button>
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s === "" ? "All statuses" : s}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => exportTxns("csv")}>Export CSV</Button>
            <Button variant="secondary" onClick={() => exportTxns("xlsx")}>Export Excel</Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : !result || result.rows.length === 0 ? (
        <EmptyState message="No transactions yet — online payments appear here once invoices are paid via Razorpay." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  {result.columns.map((c) => (
                    <th key={c.key} className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60">
                    {result.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                        {c.key === "status" ? (
                          <Badge tone={statusTone(String(r[c.key] ?? ""))}>{String(r[c.key] ?? "")}</Badge>
                        ) : c.key === "paymentLinkUrl" && r[c.key] ? (
                          <a href={String(r[c.key])} target="_blank" rel="noreferrer" className="text-brand-600 underline">
                            link
                          </a>
                        ) : (
                          fmt(c, r[c.key])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {result.totals && (
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink">
                    <td className="px-3 py-2" colSpan={Math.max(1, result.columns.length - 1)}>
                      Total ({String(result.totals.count ?? result.rows.length)}) · Paid{" "}
                      {formatMoney(String(result.totals.paidAmount ?? 0))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(String(result.totals.amount ?? 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
