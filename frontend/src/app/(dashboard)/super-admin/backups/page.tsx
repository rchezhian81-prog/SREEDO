"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_backups/OverviewTab";
import { BackupsTab } from "./_backups/BackupsTab";
import { RestoreTab } from "./_backups/RestoreTab";
import { SettingsTab } from "./_backups/SettingsTab";
import { DrGuideTab } from "./_backups/DrGuideTab";

type Tab = "overview" | "backups" | "restore" | "settings" | "dr";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "backups", label: "Backups", icon: "database" },
  { value: "restore", label: "Restore", icon: "history" },
  { value: "settings", label: "Settings", icon: "gear" },
  { value: "dr", label: "DR Guide", icon: "lifeBuoy" },
];

export default function BackupsPage() {
  const { ready, gate } = usePlatformGuard(
    "Backups",
    "Backup, restore & disaster-recovery hardening"
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  // A date range picked from the Overview chips jumps to Backups with that filter.
  const [presetRange, setPresetRange] = useState<{ dateFrom: string; dateTo: string } | null>(null);
  const [presetKey, setPresetKey] = useState(0);
  const applyRange = (range: { dateFrom: string; dateTo: string }) => {
    setPresetRange(range);
    setPresetKey((k) => k + 1);
    setTab("backups");
  };

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/platform" className="hover:text-muted">
          Platform
        </Link>{" "}
        / <span className="text-muted">Backups</span>
      </nav>

      <PageHeader
        title="Backups"
        subtitle="Backup, restore & disaster-recovery hardening"
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
      {tab === "backups" && (
        <BackupsTab
          presetRange={presetRange}
          presetKey={presetKey}
          reloadKey={reloadKey}
          onChanged={bump}
        />
      )}
      {tab === "restore" && <RestoreTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "settings" && <SettingsTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "dr" && <DrGuideTab reloadKey={reloadKey} />}
    </>
  );
}
