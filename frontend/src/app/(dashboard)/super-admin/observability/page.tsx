"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_observability/OverviewTab";
import { ServicesTab } from "./_observability/ServicesTab";
import { IncidentsTab } from "./_observability/IncidentsTab";
import { AlertsTab } from "./_observability/AlertsTab";
import { ErrorsTab } from "./_observability/ErrorsTab";
import { PerformanceTab } from "./_observability/PerformanceTab";
import { StorageTab } from "./_observability/StorageTab";
import { LogsTab } from "./_observability/LogsTab";
import { IntegrationsTab } from "./_observability/IntegrationsTab";

type Tab =
  | "overview"
  | "services"
  | "incidents"
  | "alerts"
  | "errors"
  | "performance"
  | "storage"
  | "logs"
  | "integrations";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "services", label: "Services", icon: "health" },
  { value: "incidents", label: "Incidents", icon: "shieldAlert" },
  { value: "alerts", label: "Alerts", icon: "bell" },
  { value: "errors", label: "Errors", icon: "alert" },
  { value: "performance", label: "Performance", icon: "barChart" },
  { value: "storage", label: "Storage", icon: "hardDrive" },
  { value: "logs", label: "Logs", icon: "history" },
  { value: "integrations", label: "Integrations", icon: "network" },
];

const TITLE = "Health & Observability";
const SUBTITLE = "Platform health, incidents, alerts, errors & performance";

export default function ObservabilityPage() {
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
      {tab === "services" && <ServicesTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "incidents" && <IncidentsTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "alerts" && <AlertsTab reloadKey={reloadKey} onChanged={bump} />}
      {tab === "errors" && <ErrorsTab reloadKey={reloadKey} />}
      {tab === "performance" && <PerformanceTab reloadKey={reloadKey} />}
      {tab === "storage" && <StorageTab reloadKey={reloadKey} />}
      {tab === "logs" && <LogsTab reloadKey={reloadKey} />}
      {tab === "integrations" && <IntegrationsTab reloadKey={reloadKey} />}
    </>
  );
}

export type ObservabilityTab = Tab;
