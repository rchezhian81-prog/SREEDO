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
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useTerms } from "@/lib/terms";
import type { CollegeOverview } from "@/types";

export default function CollegeHubPage() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";
  const term = useTerms();

  const [overview, setOverview] = useState<CollegeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const subPages: {
    href: string;
    label: string;
    icon: IconName;
    desc: string;
  }[] = [
    {
      href: "/college/departments",
      label: "Departments",
      icon: "network",
      desc: "Academic departments and their heads",
    },
    {
      href: "/college/programs",
      label: "Programs & Batches",
      icon: "cap",
      desc: "Degree programs and admission batches",
    },
    {
      href: "/college/semesters",
      label: "Semesters",
      icon: "calendar",
      desc: "Semesters within each program",
    },
    {
      href: "/college/subjects",
      label: `Semester ${term.subjectPlural}`,
      icon: "bookOpen",
      desc: `${term.subjectPlural} mapped to programs and semesters`,
    },
    {
      href: "/college/enrollments",
      label: "Enrollments",
      icon: "userPlus",
      desc: "Enroll students into programs and semesters",
    },
    {
      href: "/college/results",
      label: "Results",
      icon: "barChart",
      desc: "Semester results, GPA and CGPA",
    },
  ];

  const nextType: "school" | "college" =
    overview?.type === "college" ? "school" : "college";

  const performToggle = async () => {
    if (!overview) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await api.patch("/college/settings", { type: nextType });
      // Reconcile the derived mode cache immediately so nav + terminology update
      // without waiting for a remount / next /auth/me reconciliation.
      useModeStore.getState().setMode(nextType);
      await load();
      setConfirmOpen(false);
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
            <Card className="border-amber-500/30 bg-amber-500/10">
              <p className="text-sm text-amber-700 dark:text-amber-300">
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
                <p className="text-sm font-medium text-muted">{stat.label}</p>
                <p className="mt-2 text-3xl font-semibold text-ink">
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          {isAdmin && (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Institution mode
                    </h2>
                    <p className="mt-1 text-sm text-muted">
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
                    onClick={() => setConfirmOpen(true)}
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

              <ConfirmDialog
                open={confirmOpen}
                title="Switch institution mode"
                message={`Switch institution mode to "${nextType}"? This changes which features are available across the app.`}
                confirmLabel={`Switch to ${nextType} mode`}
                tone="primary"
                busy={switching}
                onConfirm={performToggle}
                onClose={() => setConfirmOpen(false)}
              />
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subPages.map((page) => (
              <Link key={page.href} href={page.href} className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                      <Icon name={page.icon} className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink">{page.label}</h3>
                      <p className="mt-1 text-sm text-muted">{page.desc}</p>
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
