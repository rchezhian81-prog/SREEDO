"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/use-permissions";
import { Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const SUB_PAGES: {
  href: string;
  label: string;
  icon: IconName;
  desc: string;
  perm: string;
}[] = [
  {
    href: "/fees/setup/categories",
    label: "Categories",
    icon: "layers",
    desc: "Group fees by category",
    perm: "fee_categories:read",
  },
  {
    href: "/fees/setup/schedules",
    label: "Schedules",
    icon: "calendar",
    desc: "Recurring fee plans & invoice generation",
    perm: "fee_schedules:read",
  },
  {
    href: "/fees/setup/fine-rules",
    label: "Fine Rules",
    icon: "clock",
    desc: "Late-payment fines & overdue application",
    perm: "fee_fines:read",
  },
  {
    href: "/fees/setup/discounts",
    label: "Discounts",
    icon: "tag",
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
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
                  <Icon name={page.icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-ink">{page.label}</h3>
                  <p className="mt-1 text-sm text-muted">{page.desc}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
