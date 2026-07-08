"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms } from "@/lib/terms";
import { Icon, type IconName } from "@/components/icons";
import {
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";

/**
 * Reports Hub — a curated, RBAC-aware catalog that links to the existing report
 * pages scattered across the app (IA consolidation, not a new report engine).
 * Every entry points at a route that already exists; the hub only groups,
 * searches and gates them so users have one place to find every report.
 */
interface ReportEntry {
  label: string;
  description: string;
  href: string;
  category: string;
  icon: IconName;
  /** Effective permission required to open the entry; omitted = always open. */
  perm?: string;
}

const CATEGORY_ORDER = [
  "Reports & Exports",
  "Exams",
  "Fees",
  "Attendance",
  "Staff & HR",
  "Operations",
] as const;

export default function ReportsHubPage() {
  const term = useTerms();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  // Catalog is static apart from mode-aware terminology, so memoise on `term`.
  const entries = useMemo<ReportEntry[]>(
    () => [
      {
        category: "Reports & Exports",
        label: "Reports Center",
        description: "Run & export prebuilt reports",
        href: "/reports-center",
        icon: "barChart",
        perm: "reports:center:read",
      },
      {
        category: "Reports & Exports",
        label: "Report Builder",
        description: "Build & save custom reports",
        href: "/report-builder",
        icon: "wrench",
        perm: "custom_reports:read",
      },
      {
        category: "Reports & Exports",
        label: "Scheduled Reports",
        description: "Automate report delivery",
        href: "/scheduled-reports",
        icon: "calendarClock",
        perm: "scheduled_reports:read",
      },
      {
        category: "Exams",
        label: `${term.reportCard}s`,
        description: `Grade scale, ${term.reportCard.toLowerCase()}s & mark sheets`,
        href: "/reports",
        icon: "file",
        perm: "reports:read",
      },
      {
        category: "Fees",
        label: "Fee Reports",
        description: "Collections, dues & outstanding",
        href: "/fees",
        icon: "receipt",
        perm: "fees:read",
      },
      {
        category: "Attendance",
        label: "Attendance Reports",
        description: "Daily / period attendance summaries",
        href: "/attendance",
        icon: "calcheck",
        perm: "attendance:read",
      },
      {
        category: "Staff & HR",
        label: "Staff & Leave Reports",
        description: "Attendance, leave & payroll",
        href: "/staff/reports",
        icon: "briefcase",
        perm: "leave:reports",
      },
      {
        category: "Staff & HR",
        label: "Payroll Reports",
        description: "Salary register & deductions",
        href: "/payroll/reports",
        icon: "wallet",
      },
      {
        category: "Operations",
        label: "Transport Reports",
        description: "Occupancy, dues & expiry",
        href: "/transport/reports",
        icon: "bus",
        perm: "transport:read",
      },
      {
        category: "Operations",
        label: "Library Reports",
        description: "Stock, circulation & fines",
        href: "/library/reports",
        icon: "bookOpen",
        perm: "library:read",
      },
      {
        category: "Operations",
        label: "Inventory Reports",
        description: "Stock register & low stock",
        href: "/inventory/reports",
        icon: "package",
        perm: "inventory:read",
      },
      {
        category: "Operations",
        label: "Hostel Reports",
        description: "Occupancy & dues",
        href: "/hostel/reports",
        icon: "building",
        perm: "hostel:read",
      },
      {
        category: "Operations",
        label: "Disciplinary Reports",
        description: "Conduct reports",
        href: "/disciplinary/reports",
        icon: "shield",
      },
    ],
    [term]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!q) return true;
      return (
        entry.label.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q)
      );
    });
  }, [entries, query, category]);

  // Group the visible entries under their category, in the fixed display order.
  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map(
        (name) =>
          [name, filtered.filter((entry) => entry.category === name)] as const
      ).filter(([, items]) => items.length > 0),
    [filtered]
  );

  return (
    <>
      <PageHeader title="Reports" subtitle="All reports in one place" />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
            className="pl-9"
          />
        </div>
        <div className="sm:w-60">
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {grouped.length === 0 ? (
        <EmptyState message="No reports match your search." />
      ) : (
        <div className="space-y-8">
          {grouped.map(([name, items]) => (
            <section key={name}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                {name}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((entry) => {
                  const allowed = can(entry.perm);
                  return allowed ? (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2"
                    >
                      <Card className="h-full transition group-hover:border-brand-500/50 group-hover:shadow-pop">
                        <EntryBody entry={entry} allowed />
                      </Card>
                    </Link>
                  ) : (
                    <div
                      key={entry.href}
                      aria-disabled="true"
                      title="Requires permission"
                    >
                      <Card className="h-full opacity-60">
                        <EntryBody entry={entry} allowed={false} />
                      </Card>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Card interior shared by the clickable and permission-gated states. */
function EntryBody({
  entry,
  allowed,
}: {
  entry: ReportEntry;
  allowed: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
          <Icon name={entry.icon} className="h-5 w-5" />
        </span>
        {allowed ? (
          <Badge tone="green">
            <Icon name="check" className="h-3 w-3" />
            Available
          </Badge>
        ) : (
          <Badge tone="slate">
            <Icon name="lock" className="h-3 w-3" />
            Requires permission
          </Badge>
        )}
      </div>
      <div>
        <h3 className="font-semibold text-ink">{entry.label}</h3>
        <p className="mt-1 text-sm text-muted">{entry.description}</p>
      </div>
      {allowed && (
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-brand-600 dark:text-brand-300">
          Open
          <Icon name="arrowRight" className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
