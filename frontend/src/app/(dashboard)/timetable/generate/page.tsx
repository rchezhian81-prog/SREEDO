"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, PageHeader } from "@/components/ui";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

interface GenResult {
  sectionsScheduled: number;
  totalEntries: number;
  periodsPerDay: number;
  days: number[];
}

export default function TimetableGeneratePage() {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const generate = async () => {
    if (days.length === 0) return setError("Pick at least one working day.");
    if (
      !confirm(
        "This replaces the current timetable for every section that has subjects assigned. Continue?"
      )
    )
      return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<GenResult>("/timetable-gen/generate", { days }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate timetable");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/timetable" className="text-sm text-brand-600 hover:underline">
          ← Back to timetable
        </Link>
      </div>
      <PageHeader
        title="Auto-generate timetable"
        subtitle="Build a clash-free timetable from each section's assigned subjects"
      />

      <div className="max-w-xl space-y-5 rounded-xl border border-line bg-surface p-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Working days</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button
                key={d.value}
                onClick={() => toggle(d.value)}
                className={
                  days.includes(d.value)
                    ? "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover"
                }
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Heads up: this <strong>replaces</strong> the existing timetable for all sections that have
          subjects assigned. Teachers are never double-booked; slots with no available teacher are left
          free for you to fill manually.
        </p>

        <ErrorNote message={error} />

        <Button onClick={generate} disabled={running}>
          {running ? "Generating…" : "Generate timetable"}
        </Button>

        {result ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Done — scheduled <strong>{result.sectionsScheduled}</strong> section(s) and placed{" "}
            <strong>{result.totalEntries}</strong> period(s) across{" "}
            {result.days.length} day(s). Review and tweak it on the{" "}
            <Link href="/timetable" className="font-medium underline">
              timetable
            </Link>
            .
          </div>
        ) : null}
      </div>
    </>
  );
}
