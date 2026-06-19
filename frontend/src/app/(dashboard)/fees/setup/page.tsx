"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { Card, EmptyState, PageHeader, Spinner } from "@/components/ui";

const SUB_PAGES: {
  href: string;
  label: string;
  icon: string;
  desc: string;
  perm: string;
}[] = [
  {
    href: "/fees/setup/categories",
    label: "Categories",
    icon: "🗂️",
    desc: "Group fees by category",
    perm: "fee_categories:read",
  },
  {
    href: "/fees/setup/schedules",
    label: "Schedules",
    icon: "📆",
    desc: "Recurring fee plans & invoice generation",
    perm: "fee_schedules:read",
  },
  {
    href: "/fees/setup/fine-rules",
    label: "Fine Rules",
    icon: "⏰",
    desc: "Late-payment fines & overdue application",
    perm: "fee_fines:read",
  },
  {
    href: "/fees/setup/discounts",
    label: "Discounts",
    icon: "🏷️",
    desc: "Discounts & scholarships",
    perm: "fee_discounts:read",
  },
];

export default function FeeSetupHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const visible = SUB_PAGES.filter((page) => can(page.perm));

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Fee Setup" subtitle="Categories, schedules, fines & discounts" />
        <Spinner />
      </>
    );
  }

  if (visible.length === 0) {
    return (
      <>
        <PageHeader title="Fee Setup" subtitle="Categories, schedules, fines & discounts" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Fee Setup" subtitle="Categories, schedules, fines & discounts" />

      <div className="mb-4">
        <Link
          href="/fees"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Fees
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((page) => (
          <Link key={page.href} href={page.href} className="block">
            <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className="text-2xl" aria-hidden>
                  {page.icon}
                </span>
                <div>
                  <h3 className="font-semibold text-slate-900">{page.label}</h3>
                  <p className="mt-1 text-sm text-slate-500">{page.desc}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
