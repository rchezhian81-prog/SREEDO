"use client";

import { useEffect, useMemo, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { TimetableEntry } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const hhmm = (value: string) => value.slice(0, 5);

interface PeriodRow {
  periodId: string;
  periodName: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
}

export default function PortalTimetablePage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    portalApi
      .get<TimetableEntry[]>(`/portal/students/${studentId}/timetable`)
      .then(setEntries)
      .catch(() => setError("Could not load the timetable."))
      .finally(() => setLoading(false));
  }, [studentId]);

  const periods = useMemo<PeriodRow[]>(() => {
    const map = new Map<string, PeriodRow>();
    for (const e of entries) {
      if (!map.has(e.periodId)) {
        map.set(e.periodId, {
          periodId: e.periodId,
          periodName: e.periodName,
          periodOrder: e.periodOrder,
          startTime: e.startTime,
          endTime: e.endTime,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.periodOrder - b.periodOrder);
  }, [entries]);

  const cellMap = useMemo(() => {
    const map = new Map<string, TimetableEntry>();
    for (const e of entries) map.set(`${e.dayOfWeek}:${e.periodId}`, e);
    return map;
  }, [entries]);

  if (!studentId) {
    return (
      <>
        <PageHeader title={t("portalPages.timetable.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title={t("portalPages.timetable.title")} subtitle="Weekly class schedule" />
      <ErrorNote message={error} />
      {periods.length === 0 ? (
        <EmptyState message="No timetable has been published yet." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-40 px-4 py-3">Period</th>
                {DAYS.map((day) => (
                  <th key={day.value} className="px-4 py-3">
                    {day.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {periods.map((period) => (
                <tr key={period.periodId} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {period.periodName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {hhmm(period.startTime)}–{hhmm(period.endTime)}
                    </div>
                  </td>
                  {DAYS.map((day) => {
                    const entry = cellMap.get(`${day.value}:${period.periodId}`);
                    return (
                      <td key={day.value} className="px-3 py-3">
                        {entry ? (
                          <div>
                            <div className="font-semibold text-slate-900">
                              {entry.subjectName}
                            </div>
                            {entry.teacherName && (
                              <div className="text-xs text-slate-500">
                                {entry.teacherName}
                              </div>
                            )}
                            {entry.roomName && (
                              <div className="text-xs text-slate-400">
                                {entry.roomName}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-300">—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
