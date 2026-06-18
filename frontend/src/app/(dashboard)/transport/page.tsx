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
import type { Driver, TransportRoute, Vehicle } from "@/types";

const SUB_PAGES: { href: string; label: string; icon: string; desc: string }[] =
  [
    {
      href: "/transport/vehicles",
      label: "Vehicles",
      icon: "🚌",
      desc: "Fleet, capacity and document expiry",
    },
    {
      href: "/transport/drivers",
      label: "Drivers",
      icon: "🧑‍✈️",
      desc: "Drivers, helpers and licences",
    },
    {
      href: "/transport/routes",
      label: "Routes & stops",
      icon: "🛣️",
      desc: "Routes, assigned vehicle/driver and stops",
    },
    {
      href: "/transport/allocations",
      label: "Allocations",
      icon: "🎒",
      desc: "Assign students to routes and stops",
    },
    {
      href: "/transport/fees",
      label: "Fees",
      icon: "💰",
      desc: "Route/stop fees and invoice generation",
    },
    {
      href: "/transport/reports",
      label: "Reports",
      icon: "📈",
      desc: "Occupancy, dues, expiry and more",
    },
  ];

export default function TransportHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [vehicleList, driverList, routeList] = await Promise.all([
        api.get<Vehicle[]>("/transport/vehicles"),
        api.get<Driver[]>("/transport/drivers"),
        api.get<TransportRoute[]>("/transport/routes"),
      ]);
      setVehicles(vehicleList);
      setDrivers(driverList);
      setRoutes(routeList);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load transport data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const studentsAllocated = routes.reduce(
    (sum, route) => sum + (route.studentCount ?? 0),
    0
  );

  const stats = [
    { label: "Vehicles", value: vehicles.length },
    { label: "Drivers", value: drivers.length },
    { label: "Routes", value: routes.length },
    { label: "Students allocated", value: studentsAllocated },
  ];

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Transport" subtitle="Fleet, routes & allocations" />
        <Spinner />
      </>
    );
  }

  if (!can("transport:read")) {
    return (
      <>
        <PageHeader title="Transport" subtitle="Fleet, routes & allocations" />
        <EmptyState message="You do not have access to transport." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Transport" subtitle="Fleet, routes & allocations" />

      {loadError ? (
        <ErrorNote message={loadError} />
      ) : (
        <div className="space-y-6">
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
