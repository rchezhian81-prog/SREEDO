"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { AiDashboard } from "@/types";

const SUB_PAGES: {
  href: string;
  label: string;
  icon: string;
  desc: string;
  perm: string;
}[] = [
  {
    href: "/ai-insights/summaries",
    label: "Report Summaries",
    icon: "📋",
    desc: "Natural-language summaries of key reports",
    perm: "ai:summarize",
  },
  {
    href: "/ai-insights/attendance-risk",
    label: "Attendance Risk",
    icon: "⚠️",
    desc: "Students below an attendance threshold",
    perm: "ai:risk_alerts",
  },
  {
    href: "/ai-insights/fee-risk",
    label: "Fee Pending",
    icon: "💳",
    desc: "Pending & overdue invoices to follow up",
    perm: "ai:risk_alerts",
  },
  {
    href: "/ai-insights/search",
    label: "Document Search",
    icon: "🔎",
    desc: "Semantic & keyword document search",
    perm: "ai:document_search",
  },
];

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export default function AiInsightsHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [data, setData] = useState<AiDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      setData(await api.get<AiDashboard>("/ai-insights/dashboard"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else {
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load AI insights"
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader
          title="AI Insights"
          subtitle="KPI summaries, risk alerts, document search & workflow suggestions — powered by AI when configured"
        />
        <Spinner />
      </>
    );
  }

  if (forbidden) {
    return (
      <>
        <PageHeader
          title="AI Insights"
          subtitle="KPI summaries, risk alerts, document search & workflow suggestions — powered by AI when configured"
        />
        <EmptyState message="You don't have access to AI insights." />
      </>
    );
  }

  const headline = data?.headline;

  const stats = [
    { label: "Active Students", value: formatNumber(headline?.students ?? 0) },
    { label: "Staff", value: formatNumber(headline?.staff ?? 0) },
    {
      label: "Fees Outstanding",
      value: formatNumber(headline?.feesOutstanding ?? 0),
    },
    {
      label: "Attendance Rate (30d)",
      value:
        headline?.attendanceRate == null
          ? "—"
          : `${headline.attendanceRate}%`,
    },
  ];

  return (
    <>
      <PageHeader
        title="AI Insights"
        subtitle="KPI summaries, risk alerts, document search & workflow suggestions — powered by AI when configured"
      />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
          {data && !data.aiAvailable && (
            <Card className="border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <span className="text-xl" aria-hidden>
                  💡
                </span>
                <p className="text-sm text-amber-800">
                  AI narration is disabled. Set <code>OPENAI_API_KEY</code> on
                  the server to enable natural-language summaries and semantic
                  search — all metrics below are still available.
                </p>
              </div>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          {can("ai:workflow_suggestions") && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Workflow suggestions
              </h2>
              {data && data.suggestions.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {data.suggestions.map((suggestion) => (
                    <li key={suggestion.key}>
                      <Link
                        href={suggestion.href}
                        className="flex items-center justify-between gap-3 py-3 transition hover:text-brand-700"
                      >
                        <span className="text-sm font-medium text-slate-800">
                          {suggestion.label}
                        </span>
                        <Badge tone="blue">{suggestion.count}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="No pending workflow items — all clear." />
              )}
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUB_PAGES.filter((page) => can(page.perm)).map((page) => (
              <Link key={page.href} href={page.href} className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden>
                      {page.icon}
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {page.label}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">{page.desc}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
