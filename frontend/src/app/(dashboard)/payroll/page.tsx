"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { money } from "@/lib/payroll";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { PayrollRun, SalaryComponent, SalaryStructure } from "@/types";

const NAV: {
  href: string;
  label: string;
  icon: string;
  desc: string;
  perm: string;
}[] = [
  {
    href: "/payroll/components",
    label: "Salary components",
    icon: "🧩",
    desc: "Earnings & deductions catalogue",
    perm: "payroll:read",
  },
  {
    href: "/payroll/structures",
    label: "Salary structures",
    icon: "📋",
    desc: "Assign salary structures to staff",
    perm: "payroll:read",
  },
  {
    href: "/payroll/run",
    label: "Run payroll",
    icon: "▶️",
    desc: "Generate & finalize monthly payroll",
    perm: "payroll:run",
  },
  {
    href: "/payroll/payslips",
    label: "Payslips",
    icon: "🧾",
    desc: "Browse, view & download payslips",
    perm: "payroll:read",
  },
  {
    href: "/payroll/reports",
    label: "Reports",
    icon: "📈",
    desc: "Register, deductions & more",
    perm: "payroll:reports",
  },
];

export default function PayrollHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canRead = can("payroll:read");
  const canPayslip = can("payroll:payslip");
  // Staff with only payslip access land on a simplified My Payslips view.
  const payslipOnly = !permsLoading && canPayslip && !canRead;

  useEffect(() => {
    if (permsLoading || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<SalaryComponent[]>("/payroll/components"),
      api.get<SalaryStructure[]>("/payroll/structures"),
      api.get<PayrollRun[]>("/payroll/runs"),
    ])
      .then(([componentList, structureList, runList]) => {
        setComponents(componentList);
        setStructures(structureList);
        setRuns(runList);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load payroll data"
        )
      )
      .finally(() => setLoading(false));
  }, [permsLoading, canRead]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Payroll" subtitle="Salary, runs & payslips" />
        <Spinner />
      </>
    );
  }

  if (payslipOnly) {
    return (
      <>
        <PageHeader title="Payroll" subtitle="Your salary slips" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/payroll/my-payslips" className="block">
            <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>
                  🧾
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900">My Payslips</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    View and download your monthly payslips
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </>
    );
  }

  if (!canRead && !canPayslip) {
    return (
      <>
        <PageHeader title="Payroll" subtitle="Salary, runs & payslips" />
        <EmptyState message="You do not have access to payroll." />
      </>
    );
  }

  const latestRun = runs[0] ?? null;
  const staffWithStructure = structures.filter((s) => s.isActive).length;

  const stats = [
    { label: "Salary components", value: String(components.length) },
    { label: "Staff with structures", value: String(staffWithStructure) },
    {
      label: "Latest run net total",
      value: latestRun ? money(latestRun.netTotal) : "—",
    },
  ];

  return (
    <>
      <PageHeader title="Payroll" subtitle="Salary, runs & payslips" />

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
                <p className="mt-2 text-3xl font-semibold text-slate-900">
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NAV.filter((page) => can(page.perm)).map((page) => (
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
            {canPayslip && (
              <Link href="/payroll/my-payslips" className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden>
                      🧾
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        My Payslips
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Your own monthly payslips
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
