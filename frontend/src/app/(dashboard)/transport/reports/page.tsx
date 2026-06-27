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
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { ReportData, RouteStop, TransportRoute } from "@/types";

const REPORTS: {
  key: string;
  title: string;
  needsRoute?: boolean;
  needsStop?: boolean;
}[] = [
  { key: "transport_route_students", title: "Route students", needsRoute: true },
  { key: "transport_stop_students", title: "Stop students", needsStop: true },
  { key: "transport_vehicles", title: "Vehicles" },
  { key: "transport_drivers", title: "Drivers" },
  { key: "transport_fee_dues", title: "Fee dues" },
  { key: "transport_occupancy", title: "Occupancy" },
  { key: "transport_expiry", title: "Document expiry" },
];

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function TransportReportsPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [selectedKey, setSelectedKey] = useState<string>(REPORTS[0].key);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [routeId, setRouteId] = useState("");
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [stopRouteId, setStopRouteId] = useState("");
  const [stopId, setStopId] = useState("");

  const [data, setData] = useState<ReportData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const selected = REPORTS.find((report) => report.key === selectedKey)!;

  useEffect(() => {
    api
      .get<TransportRoute[]>("/transport/routes")
      .then(setRoutes)
      .catch(() => undefined);
  }, []);

  // Stops for the stop-students report depend on the chosen route.
  useEffect(() => {
    if (!stopRouteId) {
      setStops([]);
      return;
    }
    let active = true;
    api
      .get<RouteStop[]>(`/transport/routes/${stopRouteId}/stops`)
      .then((list) => {
        if (active) setStops(list);
      })
      .catch(() => {
        if (active) setStops([]);
      });
    return () => {
      active = false;
    };
  }, [stopRouteId]);

  const runReport = useCallback(
    async (key: string, route: string, stop: string) => {
      const report = REPORTS.find((item) => item.key === key);
      if (report?.needsRoute && !route) {
        setData(null);
        setDataError(null);
        return;
      }
      if (report?.needsStop && !stop) {
        setData(null);
        setDataError(null);
        return;
      }
      setDataLoading(true);
      setDataError(null);
      try {
        const params = new URLSearchParams();
        if (report?.needsRoute) params.set("routeId", route);
        if (report?.needsStop) params.set("stopId", stop);
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
    if (permsLoading || !can("transport:reports")) return;
    runReport(selectedKey, routeId, stopId);
  }, [permsLoading, can, selectedKey, routeId, stopId, runReport]);

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Transport reports" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:reports")) {
    return (
      <>
        <PageHeader title="Transport reports" />
        <EmptyState message="You do not have permission to view transport reports." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transport reports"
        subtitle="Occupancy, dues & expiry"
      />

      <div className="mb-4">
        <Link
          href="/transport"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Transport
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
              {selected.needsRoute && (
                <div className="w-64">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Route
                  </span>
                  <Select
                    value={routeId}
                    onChange={(event) => setRouteId(event.target.value)}
                  >
                    <option value="">Select a route…</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>
                        {route.name} ({route.code})
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {selected.needsStop && (
                <>
                  <div className="w-56">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      Route
                    </span>
                    <Select
                      value={stopRouteId}
                      onChange={(event) => {
                        setStopRouteId(event.target.value);
                        setStopId("");
                      }}
                    >
                      <option value="">Select a route…</option>
                      {routes.map((route) => (
                        <option key={route.id} value={route.id}>
                          {route.name} ({route.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-56">
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                      Stop
                    </span>
                    <Select
                      value={stopId}
                      onChange={(event) => setStopId(event.target.value)}
                      disabled={!stopRouteId}
                    >
                      <option value="">Select a stop…</option>
                      {stops.map((stop) => (
                        <option key={stop.id} value={stop.id}>
                          {stop.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
              <Button
                variant="secondary"
                onClick={() => runReport(selectedKey, routeId, stopId)}
                disabled={
                  dataLoading ||
                  (selected.needsRoute && !routeId) ||
                  (selected.needsStop && !stopId)
                }
              >
                {dataLoading ? "Running…" : "Refresh"}
              </Button>
            </div>
          </div>

          <ErrorNote message={dataError} />

          {selected.needsRoute && !routeId ? (
            <EmptyState message="Select a route to run this report" />
          ) : selected.needsStop && !stopId ? (
            <EmptyState message="Select a route and stop to run this report" />
          ) : dataLoading ? (
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
