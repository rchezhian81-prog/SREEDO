"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { AiFeeRisk } from "@/types";

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function FeeRiskPage() {
  const { can, loading: permsLoading } = usePermissions();
  const allowed = can("ai:risk_alerts");

  const [data, setData] = useState<AiFeeRisk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AiFeeRisk>("/ai-insights/risk/fees"));
    } catch (err) {
      setData(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to load fee insights"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !allowed) return;
    load();
  }, [permsLoading, allowed, load]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Fee pending" />
        <Spinner />
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title="Fee pending" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  const stats = [
    { label: "Pending Invoices", value: formatNumber(data?.pendingCount ?? 0) },
    { label: "Overdue", value: formatNumber(data?.overdueCount ?? 0) },
    {
      label: "Total Outstanding",
      value: formatNumber(data?.totalOutstanding ?? 0),
    },
  ];

  return (
    <>
      <PageHeader
        title="Fee pending"
        subtitle="Pending & overdue invoices to follow up on"
        action={
          <Link href="/communication">
            <Button variant="secondary">Go to Communication</Button>
          </Link>
        }
      />

      <div className="mb-4">
        <Link
          href="/ai-insights"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to AI Insights
        </Link>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <p className="text-sm font-medium text-slate-500">
                  {stat.label}
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          {(data.suggestedAction || !data.aiAvailable) && (
            <Card className="border-blue-200 bg-blue-50">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-blue-900">
                  Suggested action
                </h2>
                {!data.aiAvailable && <Badge tone="slate">AI off</Badge>}
              </div>
              {data.suggestedAction ? (
                <p className="text-sm text-blue-800">{data.suggestedAction}</p>
              ) : (
                <p className="text-sm text-blue-800/70">
                  AI narration disabled — showing metrics only.
                </p>
              )}
            </Card>
          )}

          {data.narrative && (
            <Card>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {data.narrative}
              </p>
            </Card>
          )}

          {data.invoices.length > 0 ? (
            <Card>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Invoice No</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Outstanding</th>
                      <th className="px-4 py-3">Due Date</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-4 py-3 text-slate-600">
                          {invoice.invoiceNo}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {invoice.student}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatNumber(invoice.outstanding)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(invoice.dueDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={invoice.overdue ? "red" : "slate"}>
                            {invoice.overdue ? "Overdue" : "Pending"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <EmptyState message="No pending invoices — all fees are settled." />
          )}
        </div>
      ) : null}
    </>
  );
}
