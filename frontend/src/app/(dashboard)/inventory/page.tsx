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
import { Icon, type IconName } from "@/components/icons";
import type { InventoryItem, ItemCategory, Vendor } from "@/types";

const SUB_PAGES: {
  href: string;
  label: string;
  icon: IconName;
  desc: string;
  perm: string;
}[] = [
  {
    href: "/inventory/items",
    label: "Items",
    icon: "package",
    desc: "Stock items, levels & movements",
    perm: "inventory:read",
  },
  {
    href: "/inventory/categories",
    label: "Categories",
    icon: "tag",
    desc: "Group items by category",
    perm: "inventory:read",
  },
  {
    href: "/inventory/vendors",
    label: "Vendors",
    icon: "building",
    desc: "Suppliers and contacts",
    perm: "inventory:read",
  },
  {
    href: "/inventory/purchase",
    label: "Purchase",
    icon: "receipt",
    desc: "Stock-in from vendors",
    perm: "inventory:purchase",
  },
  {
    href: "/inventory/issue",
    label: "Issue",
    icon: "packageOpen",
    desc: "Stock-out to staff/departments",
    perm: "inventory:issue",
  },
  {
    href: "/inventory/adjustments",
    label: "Adjustments",
    icon: "wrench",
    desc: "Damage, loss & corrections",
    perm: "inventory:adjust",
  },
  {
    href: "/inventory/reports",
    label: "Reports",
    icon: "barChart",
    desc: "Stock register, low stock & more",
    perm: "inventory:reports",
  },
];

const TILE_ICON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300";

export default function InventoryHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [itemList, categoryList, vendorList] = await Promise.all([
        api.get<InventoryItem[]>("/inventory/items"),
        api.get<ItemCategory[]>("/inventory/categories"),
        api.get<Vendor[]>("/inventory/vendors"),
      ]);
      setItems(itemList);
      setCategories(categoryList);
      setVendors(vendorList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load inventory data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lowStockCount = items.filter((item) => item.lowStock).length;

  const stats = [
    { label: "Items", value: items.length },
    { label: "Categories", value: categories.length },
    { label: "Vendors", value: vendors.length },
    { label: "Low stock", value: lowStockCount },
  ];

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Inventory" subtitle="Stock, purchases & issues" />
        <Spinner />
      </>
    );
  }

  if (!can("inventory:read")) {
    return (
      <>
        <PageHeader title="Inventory" subtitle="Stock, purchases & issues" />
        <EmptyState message="You do not have access to inventory." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock, purchases & issues" />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <p className="text-sm font-medium text-muted">
                  {stat.label}
                </p>
                <p
                  className={
                    stat.label === "Low stock" && stat.value > 0
                      ? "mt-2 text-3xl font-semibold text-danger"
                      : "mt-2 text-3xl font-semibold text-ink"
                  }
                >
                  {stat.value}
                </p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUB_PAGES.filter((page) => can(page.perm)).map((page) => (
              <Link key={page.href} href={page.href} className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start gap-3">
                    <span className={TILE_ICON}>
                      <Icon name={page.icon} className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold text-ink">
                        {page.label}
                      </h3>
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
