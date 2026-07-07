"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_communication/OverviewTab";
import { TemplatesTab } from "./_communication/TemplatesTab";
import { DeliveriesTab } from "./_communication/DeliveriesTab";
import { BroadcastsTab } from "./_communication/BroadcastsTab";
import { ReportsTab } from "./_communication/ReportsTab";
import { PreferencesTab } from "./_communication/PreferencesTab";

type Tab = "overview" | "templates" | "deliveries" | "broadcasts" | "reports" | "preferences";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "templates", label: "Templates", icon: "file" },
  { value: "deliveries", label: "Deliveries", icon: "mail" },
  { value: "broadcasts", label: "Broadcasts", icon: "megaphone" },
  { value: "reports", label: "Reports", icon: "barChart" },
  { value: "preferences", label: "Preferences", icon: "gear" },
];

const TITLE = "Communication Admin";
const SUBTITLE = "Email templates, delivery logs, broadcasts & notification governance";

export default function CommunicationAdminPage() {
  const { ready, gate } = usePlatformGuard(TITLE, SUBTITLE);

  const [tab, setTab] = useState<Tab>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/platform" className="hover:text-muted">
          Platform
        </Link>{" "}
        / <span className="text-muted">{TITLE}</span>
      </nav>

      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
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

      {tab === "overview" && <OverviewTab reloadKey={reloadKey} onJump={setTab} />}
      {tab === "templates" && <TemplatesTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "deliveries" && <DeliveriesTab reloadKey={reloadKey} />}
      {tab === "broadcasts" && <BroadcastsTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "reports" && <ReportsTab reloadKey={reloadKey} />}
      {tab === "preferences" && <PreferencesTab reloadKey={reloadKey} onChanged={bump} />}
    </>
  );
}

export type CommunicationTab = Tab;
