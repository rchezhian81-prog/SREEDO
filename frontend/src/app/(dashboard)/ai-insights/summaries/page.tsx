"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
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
import type { AiSummary } from "@/types";

const REPORTS = [
  "attendance",
  "fees",
  "exams",
  "homework",
  "payroll",
  "library",
  "transport",
  "hostel",
  "inventory",
] as const;

function titleCase(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function AiSummariesPage() {
  const { can, loading: permsLoading } = usePermissions();
  const allowed = can("ai:summarize");

  const [report, setReport] = useState<string>(REPORTS[0]);
  const [data, setData] = useState<AiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AiSummary>(`/ai-insights/summary/${report}`));
    } catch (err) {
      setData(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to generate summary"
      );
    } finally {
      setLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Report summaries" />
        <Spinner />
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title="Report summaries" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  const metricEntries = data ? Object.entries(data.metrics) : [];

  return (
    <>
      <PageHeader
        title="Report summaries"
        subtitle="AI narration of key report metrics"
      />

      <div className="mb-4">
        <Link
          href="/ai-insights"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to AI Insights
        </Link>
      </div>

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Field label="Report">
                <Select
                  value={report}
                  onChange={(event) => setReport(event.target.value)}
                >
                  {REPORTS.map((name) => (
                    <option key={name} value={name}>
                      {titleCase(name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button onClick={generate} disabled={loading}>
              {loading ? "Generating…" : "Generate summary"}
            </Button>
          </div>
        </Card>

        <ErrorNote message={error} />

        {loading ? (
          <Spinner />
        ) : data ? (
          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {titleCase(data.report)}
              </h2>
              {!data.aiAvailable && <Badge tone="slate">AI off</Badge>}
            </div>

            {data.narrative ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {data.narrative}
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                AI narration disabled — showing metrics only.
              </p>
            )}

            {metricEntries.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Metric</th>
                      <th className="px-4 py-3">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metricEntries.map(([key, value]) => (
                      <tr key={key}>
                        <td className="px-4 py-3 text-slate-600">
                          {titleCase(key)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {formatMetric(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                No metrics available for this report.
              </p>
            )}
          </Card>
        ) : (
          <EmptyState message="Choose a report and generate a summary." />
        )}
      </div>
    </>
  );
}
