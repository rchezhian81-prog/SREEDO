"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_jobsops/OverviewTab";
import { JobsTab } from "./_jobsops/JobsTab";
import { DeadLetterTab } from "./_jobsops/DeadLetterTab";
import { WorkersTab } from "./_jobsops/WorkersTab";
import { SchedulerTab } from "./_jobsops/SchedulerTab";
import { AlertsTab } from "./_jobsops/AlertsTab";
import { ReportsTab } from "./_jobsops/ReportsTab";

type Tab = "overview" | "jobs" | "deadletter" | "workers" | "scheduler" | "alerts" | "reports";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "jobs", label: "Jobs", icon: "layers" },
  { value: "deadletter", label: "Dead-letter", icon: "packageOpen" },
  { value: "workers", label: "Workers", icon: "network" },
  { value: "scheduler", label: "Scheduler", icon: "calendarClock" },
  { value: "alerts", label: "Alerts", icon: "bell" },
  { value: "reports", label: "Reports", icon: "barChart" },
];

const TITLE = "Background Jobs";
const SUBTITLE = "Queue governance, workers, scheduler, dead-letter & alerts";

export default function SuperAdminJobsPage() {
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
      {tab === "jobs" && <JobsTab reloadKey={reloadKey} />}
      {tab === "deadletter" && <DeadLetterTab reloadKey={reloadKey} />}
      {tab === "workers" && <WorkersTab reloadKey={reloadKey} />}
      {tab === "scheduler" && <SchedulerTab reloadKey={reloadKey} />}
      {tab === "alerts" && <AlertsTab reloadKey={reloadKey} />}
      {tab === "reports" && <ReportsTab reloadKey={reloadKey} />}
    </>
  );
}

export type JobsTab = Tab;
