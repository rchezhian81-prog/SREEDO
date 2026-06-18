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
import type { Hostel } from "@/types";

const SUB_PAGES: { href: string; label: string; icon: string; desc: string }[] =
  [
    {
      href: "/hostel/hostels",
      label: "Hostels",
      icon: "🏨",
      desc: "Buildings, wardens and capacity",
    },
    {
      href: "/hostel/allocations",
      label: "Allocations",
      icon: "🛏️",
      desc: "Assign students to rooms and beds",
    },
    {
      href: "/hostel/fees",
      label: "Fees",
      icon: "💰",
      desc: "Hostel/room-type fees and invoices",
    },
    {
      href: "/hostel/reports",
      label: "Reports",
      icon: "📈",
      desc: "Occupancy, dues, vacated and more",
    },
  ];

export default function HostelHubPage() {
  const { can, loading: permsLoading } = usePermissions();

  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setHostels(await api.get<Hostel[]>("/hostel/hostels"));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load hostel data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = hostels.reduce(
    (acc, hostel) => ({
      rooms: acc.rooms + (hostel.roomCount ?? 0),
      beds: acc.beds + (hostel.bedCount ?? 0),
      occupied: acc.occupied + (hostel.occupied ?? 0),
    }),
    { rooms: 0, beds: 0, occupied: 0 }
  );

  const stats = [
    { label: "Hostels", value: hostels.length },
    { label: "Rooms", value: totals.rooms },
    { label: "Beds", value: totals.beds },
    { label: "Occupied", value: totals.occupied },
  ];

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Hostel" subtitle="Rooms, allocations & fees" />
        <Spinner />
      </>
    );
  }

  if (!can("hostel:read")) {
    return (
      <>
        <PageHeader title="Hostel" subtitle="Rooms, allocations & fees" />
        <EmptyState message="You do not have access to hostel." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Hostel" subtitle="Rooms, allocations & fees" />

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
