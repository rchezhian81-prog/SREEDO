"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { InventoryItem, ReportData, Vendor } from "@/types";

type FilterKind = "vendor" | "item";

const REPORTS: {
  key: string;
  title: string;
  filter?: FilterKind;
  dateRange?: boolean;
}[] = [
  { key: "inventory_stock_register", title: "Stock register" },
  { key: "inventory_low_stock", title: "Low stock" },
  {
    key: "inventory_purchases",
    title: "Purchases",
    filter: "vendor",
    dateRange: true,
  },
  { key: "inventory_issues", title: "Issues", filter: "item" },
  { key: "inventory_vendor_purchases", title: "Vendor purchases" },
  { key: "inventory_item_movements", title: "Item movements", filter: "item" },
  { key: "inventory_damaged_lost", title: "Damaged / lost" },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function InventoryReportsPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [selectedKey, setSelectedKey] = useState<string>(REPORTS[0].key);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);

  const [vendorId, setVendorId] = useState("");
  const [itemId, setItemId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selected = REPORTS.find((report) => report.key === selectedKey)!;
  const canReports = can("inventory:reports");

  useEffect(() => {
    if (permsLoading || !canReports) return;
    Promise.all([
      api.get<Vendor[]>("/inventory/vendors"),
      api.get<InventoryItem[]>("/inventory/items"),
    ])
      .then(([vendorList, itemList]) => {
        setVendors(vendorList);
        setItems(itemList);
      })
      .catch(() => undefined);
  }, [permsLoading, canReports]);

  const runReport = useCallback(
    async (
      key: string,
      filters: { vendorId: string; itemId: string; dateFrom: string; dateTo: string }
    ) => {
      setDataLoading(true);
      setDataError(null);
      try {
        const report = REPORTS.find((item) => item.key === key);
        const params = new URLSearchParams();
        if (report?.filter === "vendor" && filters.vendorId) {
          params.set("vendorId", filters.vendorId);
        }
        if (report?.filter === "item" && filters.itemId) {
          params.set("itemId", filters.itemId);
        }
        if (report?.dateRange) {
          if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
          if (filters.dateTo) params.set("dateTo", filters.dateTo);
        }
        const qs = params.toString();
        setData(
          await api.get<ReportData>(
            `/report-center/${key}${qs ? `?${qs}` : ""}`
          )
        );
      } catch (err) {
        setData(null);
        setDataError(
          err instanceof ApiError ? err.message : "Failed to load report"
        );
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (permsLoading || !canReports) return;
    runReport(selectedKey, { vendorId, itemId, dateFrom, dateTo });
  }, [
    permsLoading,
    canReports,
    selectedKey,
    vendorId,
    itemId,
    dateFrom,
    dateTo,
    runReport,
  ]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Inventory reports" />
        <Spinner />
      </>
    );
  }

  if (!canReports) {
    return (
      <>
        <PageHeader title="Inventory reports" />
        <EmptyState message="You do not have permission to view inventory reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Inventory reports"
        subtitle="Stock register, low stock & more"
      />

      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Inventory
        </Link>
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((report) => (
            <button
              key={report.key}
              onClick={() => setSelectedKey(report.key)}
              className={cx(
                "rounded-lg border px-3 py-2 text-sm font-medium transition",
                report.key === selectedKey
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              {report.title}
            </button>
          ))}
        </div>

        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {data?.title ?? selected.title}
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              {selected.filter === "vendor" && (
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Vendor
                  </span>
                  <Select
                    value={vendorId}
                    onChange={(event) => setVendorId(event.target.value)}
                  >
                    <option value="">All vendors</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {selected.filter === "item" && (
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Item
                  </span>
                  <Select
                    value={itemId}
                    onChange={(event) => setItemId(event.target.value)}
                  >
                    <option value="">All items</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {selected.dateRange && (
                <>
                  <div className="w-40">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      From
                    </span>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                    />
                  </div>
                  <div className="w-40">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      To
                    </span>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                    />
                  </div>
                </>
              )}
              <Button
                variant="secondary"
                onClick={() =>
                  runReport(selectedKey, {
                    vendorId,
                    itemId,
                    dateFrom,
                    dateTo,
                  })
                }
                disabled={dataLoading}
              >
                {dataLoading ? "Running…" : "Refresh"}
              </Button>
            </div>
          </div>

          <ErrorNote message={dataError} />

          {dataLoading ? (
            <Spinner />
          ) : data && data.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      {data.columns.map((col) => (
                        <th
                          key={col.key}
                          className="whitespace-nowrap px-4 py-3"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {data.columns.map((col) => (
                          <td
                            key={col.key}
                            className="whitespace-nowrap px-4 py-3 text-slate-600"
                          >
                            {renderCell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {data.rows.length} {data.rows.length === 1 ? "row" : "rows"}
              </p>
            </>
          ) : !dataError ? (
            <EmptyState message="No rows for this report" />
          ) : null}
        </Card>
      </div>
    </>
  );
}
