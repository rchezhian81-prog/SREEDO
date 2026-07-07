"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useModeStore } from "@/stores/mode-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { CollegeOverview } from "@/types";

const SUB_PAGES: { href: string; label: string; icon: string; desc: string }[] =
  [
    {
      href: "/college/departments",
      label: "Departments",
      icon: "🏢",
      desc: "Academic departments and their heads",
    },
    {
      href: "/college/programs",
      label: "Programs & Batches",
      icon: "🎓",
      desc: "Degree programs and admission batches",
    },
    {
      href: "/college/semesters",
      label: "Semesters",
      icon: "📆",
      desc: "Semesters within each program",
    },
    {
      href: "/college/subjects",
      label: "Semester Subjects",
      icon: "📚",
      desc: "Subjects mapped to programs and semesters",
    },
    {
      href: "/college/enrollments",
      label: "Enrollments",
      icon: "🧑‍🎓",
      desc: "Enroll students into programs and semesters",
    },
    {
      href: "/college/results",
      label: "Results",
      icon: "📊",
      desc: "Semester results, GPA and CGPA",
    },
  ];

export default function CollegeHubPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [overview, setOverview] = useState<CollegeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setOverview(await api.get<CollegeOverview>("/college/overview"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load college overview"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleMode = async () => {
    if (!overview) return;
    const next = overview.type === "college" ? "school" : "college";
    if (
      !confirm(
        `Switch institution mode to "${next}"? This changes which features are available across the app.`
      )
    )
      return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await api.patch("/college/settings", { type: next });
      // Reconcile the derived mode cache immediately so nav + terminology update
      // without waiting for a remount / next /auth/me reconciliation.
      useModeStore.getState().setMode(next);
      await load();
    } catch (err) {
      setSwitchError(
        err instanceof ApiError ? err.message : "Failed to update settings"
      );
    } finally {
      setSwitching(false);
    }
  };

  const stats = overview
    ? [
        { label: "Departments", value: overview.departments },
        { label: "Programs", value: overview.programs },
        { label: "Semesters", value: overview.semesters },
        { label: "Enrollments", value: overview.enrollments },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="College"
        subtitle="Departments, programs, semesters, enrollment & results"
        action={
          overview ? (
            <Badge tone={overview.type === "college" ? "blue" : "slate"}>
              {overview.type === "college" ? "College mode" : "School mode"}
            </Badge>
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorNote message={loadError} />
      ) : !overview ? (
        <EmptyState message="No college data available" />
      ) : (
        <div className="space-y-6">
          {overview.type === "school" && (
            <Card className="border-amber-200 bg-amber-50">
              <p className="text-sm text-amber-800">
                This institution is in <strong>school mode</strong>. College
                features (departments, programs, semesters, enrollment and
                results) are available below, but enable college mode to surface
                them across the app.
                {!isAdmin &&
                  " Ask an administrator to switch the institution mode."}
              </p>
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

          {isAdmin && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Institution mode
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Currently{" "}
                    <strong>
                      {overview.type === "college" ? "College" : "School"}
                    </strong>
                    . Switch to{" "}
                    {overview.type === "college" ? "school" : "college"} mode.
                  </p>
                </div>
                <Button
                  variant={overview.type === "college" ? "secondary" : "primary"}
                  onClick={toggleMode}
                  disabled={switching}
                >
                  {switching
                    ? "Switching…"
                    : overview.type === "college"
                      ? "Switch to school mode"
                      : "Switch to college mode"}
                </Button>
              </div>
              <div className="mt-3">
                <ErrorNote message={switchError} />
              </div>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUB_PAGES.map((page) => (
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
