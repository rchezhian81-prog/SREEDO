"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_exports/OverviewTab";
import { ExportsTab } from "./_exports/ExportsTab";
import { PortabilityTab } from "./_exports/PortabilityTab";
import { SchedulesTab } from "./_exports/SchedulesTab";
import { RetentionTab } from "./_exports/RetentionTab";

type Tab = "overview" | "exports" | "portability" | "schedules" | "retention";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "exports", label: "Exports", icon: "fileDown" },
  { value: "portability", label: "Portability", icon: "packageOpen" },
  { value: "schedules", label: "Schedules", icon: "calendarClock" },
  { value: "retention", label: "Retention", icon: "clock" },
];

export default function ExportsPage() {
  const { ready, gate } = usePlatformGuard(
    "Data Export Center",
    "Governed, masked platform exports — history, portability, schedules & retention"
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  // A date range picked from the Overview chips jumps to Exports with that filter.
  const [presetRange, setPresetRange] = useState<{ dateFrom: string; dateTo: string } | null>(null);
  const [presetKey, setPresetKey] = useState(0);
  const applyRange = (range: { dateFrom: string; dateTo: string }) => {
    setPresetRange(range);
    setPresetKey((k) => k + 1);
    setTab("exports");
  };

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/platform" className="hover:text-muted">
          Platform
        </Link>{" "}
        / <span className="text-muted">Data Export Center</span>
      </nav>

      <PageHeader
        title="Data Export Center"
        subtitle="Governed, masked platform exports — history, portability, schedules & retention"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={bump}>
              <Icon name="history" className="h-4 w-4" />
              Refresh
            </Button>
            <Link href="/super-admin/platform">
              <Button variant="secondary">← Back</Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.value ? "bg-brand-600 text-white" : "text-muted hover:bg-hover"
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab reloadKey={reloadKey} onApplyRange={applyRange} />}
      {tab === "exports" && (
        <ExportsTab
          presetRange={presetRange}
          presetKey={presetKey}
          reloadKey={reloadKey}
          onChanged={bump}
        />
      )}
      {tab === "portability" && (
        <PortabilityTab
          reloadKey={reloadKey}
          onChanged={bump}
          onJumpToExports={() => setTab("exports")}
        />
      )}
      {tab === "schedules" && <SchedulesTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "retention" && <RetentionTab reloadKey={reloadKey} onChanged={bump} />}
    </>
  );
}
