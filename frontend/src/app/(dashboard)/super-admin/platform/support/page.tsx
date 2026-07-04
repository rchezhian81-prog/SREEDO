"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import type { PlatformInstitution, SupportTemplates } from "@/types";
import { usePlatformGuard } from "../_guard";
import { SummaryCards } from "./_support/SummaryCards";
import { StartForm } from "./_support/StartForm";
import { ActiveSessions } from "./_support/ActiveSessions";
import { HistoryTable } from "./_support/HistoryTable";
import { GovernanceCards } from "./_support/GovernanceCards";
import { SessionDrawer } from "./_support/SessionDrawer";

type Tab = "overview" | "start" | "active" | "history" | "governance";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "start", label: "Start session", icon: "userPlus" },
  { value: "active", label: "Active", icon: "shield" },
  { value: "history", label: "History", icon: "file" },
  { value: "governance", label: "Governance", icon: "lock" },
];

export default function PlatformSupportPage() {
  const { ready, gate } = usePlatformGuard(
    "Support access",
    "Start, monitor and govern audited, scope-enforced support sessions"
  );

  const [tab, setTab] = useState<Tab>("overview");
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  // Reference data shared by the Start form and History filters — loaded once.
  const [templates, setTemplates] = useState<SupportTemplates | null>(null);
  const [institutions, setInstitutions] = useState<PlatformInstitution[]>([]);

  useEffect(() => {
    if (!ready) return;
    api.get<SupportTemplates>("/platform/support/templates").then(setTemplates).catch(() => undefined);
    api
      .get<{ rows: PlatformInstitution[] }>("/platform/institutions?pageSize=100&sort=name&order=asc")
      .then((d) => setInstitutions(d.rows))
      .catch(() => undefined);
  }, [ready]);

  if (!ready) return gate;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/platform" className="hover:text-muted">
          Platform
        </Link>{" "}
        / <span className="text-muted">Support access</span>
      </nav>

      <PageHeader
        title="Support access"
        subtitle="Start, monitor and govern audited, scope-enforced support sessions"
        action={
          <Link href="/super-admin/platform">
            <Button variant="secondary">← Back</Button>
          </Link>
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

      {tab === "overview" && <SummaryCards onOpenSession={setOpenSessionId} />}
      {tab === "start" && <StartForm templates={templates} />}
      {tab === "active" && (
        <ActiveSessions reloadKey={reloadKey} onOpenSession={setOpenSessionId} onChanged={bump} />
      )}
      {tab === "history" && (
        <HistoryTable
          templates={templates}
          institutions={institutions}
          reloadKey={reloadKey}
          onOpenSession={setOpenSessionId}
        />
      )}
      {tab === "governance" && (
        <GovernanceCards reloadKey={reloadKey} onOpenSession={setOpenSessionId} />
      )}

      <SessionDrawer id={openSessionId} onClose={() => setOpenSessionId(null)} onChanged={bump} />
    </>
  );
}
