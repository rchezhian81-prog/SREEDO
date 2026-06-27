"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEAL_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
};

interface MenuItem {
  id: string;
  dayOfWeek: number;
  meal: string;
  items: string;
  notes: string | null;
}

export default function PortalMessPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await portalApi.get<MenuItem[]>("/portal/mess-menu");
        if (!cancelled) setRows(data);
      } catch {
        if (!cancelled) setError("Could not load the mess menu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byDay = DAYS.map((label, i) => ({
    label,
    items: rows.filter((r) => r.dayOfWeek === i),
  })).filter((d) => d.items.length > 0);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">{t("portalNav.mess")}</h1>
      <p className="mb-6 text-sm text-slate-500">This week&apos;s mess menu.</p>

      {loading ? (
        <Spinner />
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : byDay.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No menu has been published yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {byDay.map((day) => (
            <div key={day.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-semibold text-slate-900">{day.label}</h2>
              <ul className="space-y-2">
                {day.items.map((m) => (
                  <li key={m.id} className="text-sm">
                    <span className="font-medium text-brand-700">{MEAL_LABEL[m.meal] ?? m.meal}</span>
                    <span className="text-slate-700">: {m.items}</span>
                    {m.notes ? <span className="block text-xs text-slate-400">{m.notes}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
