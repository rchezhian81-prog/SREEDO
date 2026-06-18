"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { LeaveBalance, LeaveRequest } from "@/types";

export default function LeaveHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [requestList, balanceList] = await Promise.all([
        api.get<LeaveRequest[]>("/leave/requests"),
        api.get<LeaveBalance[]>("/leave/balances"),
      ]);
      setRequests(requestList);
      setBalances(balanceList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load leave data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permsLoading || !can("leave:read")) return;
    load();
  }, [permsLoading, can, load]);

  const subPages = [
    {
      href: "/leave/requests",
      label: "Requests",
      icon: "📝",
      desc: "View requests & request leave",
      show: can("leave:read"),
    },
    {
      href: "/leave/balances",
      label: "Balances",
      icon: "💼",
      desc: "Leave balances by staff & type",
      show: can("leave:read"),
    },
    {
      href: "/leave/approvals",
      label: "Approvals",
      icon: "✅",
      desc: "Approve or reject pending leave",
      show: can("leave:approve") || can("leave:reject"),
    },
    {
      href: "/leave/types",
      label: "Types & setup",
      icon: "⚙️",
      desc: "Leave types and balance setup",
      show: can("leave:approve"),
    },
  ].filter((page) => page.show);

  const pending = requests.filter((r) => r.status === "pending").length;

  const stats = [
    { label: "Requests", value: requests.length },
    { label: "Pending", value: pending },
    { label: "My/visible balances", value: balances.length },
  ];

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Leave" subtitle="Requests, balances & approvals" />
        <Spinner />
      </>
    );
  }

  if (!can("leave:read")) {
    return (
      <>
        <PageHeader title="Leave" subtitle="Requests, balances & approvals" />
        <EmptyState message="You do not have access to leave." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Leave" subtitle="Requests, balances & approvals" />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <p className="text-sm font-medium text-slate-500">
                  {stat.label}
                </p>
                <p
                  className={
                    stat.label === "Pending" && stat.value > 0
                      ? "mt-2 text-3xl font-semibold text-amber-600"
                      : "mt-2 text-3xl font-semibold text-slate-900"
                  }
                >
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subPages.map((page) => (
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
