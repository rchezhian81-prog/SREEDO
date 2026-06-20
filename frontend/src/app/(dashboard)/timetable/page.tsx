"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Card, PageHeader, Spinner } from "@/components/ui";
import type { Period, Room } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

export default function TimetableHubPage() {
  const { t } = useI18n();
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [periods, setPeriods] = useState<Period[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Period[]>("/timetable/periods"),
      api.get<Room[]>("/timetable/rooms"),
    ])
      .then(([p, r]) => {
        setPeriods(p);
        setRooms(r);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader title={t("pages.timetable.title")} subtitle={t("pages.timetable.subtitle")} />

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-sm font-medium text-slate-500">Periods</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">
                {periods.length}
              </p>
            </Card>
            <Card>
              <p className="text-sm font-medium text-slate-500">Rooms</p>
              <p className="mt-1 text-3xl font-semibold text-slate-900">
                {rooms.length}
              </p>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Link href="/timetable/classes" className="block">
              <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                <div className="text-2xl" aria-hidden>
                  🏫
                </div>
                <h3 className="mt-2 font-semibold text-slate-900">
                  Class timetable
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  View and manage the weekly schedule for a section.
                </p>
              </Card>
            </Link>

            <Link href="/timetable/teachers" className="block">
              <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                <div className="text-2xl" aria-hidden>
                  👩‍🏫
                </div>
                <h3 className="mt-2 font-semibold text-slate-900">
                  Teacher timetable
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  See where each teacher is scheduled across the week.
                </p>
              </Card>
            </Link>

            {isAdmin && (
              <Link href="/timetable/setup" className="block">
                <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
                  <div className="text-2xl" aria-hidden>
                    ⚙️
                  </div>
                  <h3 className="mt-2 font-semibold text-slate-900">
                    Setup: periods & rooms
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Define the period bells and the rooms used for classes.
                  </p>
                </Card>
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
