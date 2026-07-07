"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, PageHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { usePlatformGuard } from "../platform/_guard";
import { OverviewTab } from "./_help/OverviewTab";
import { ModuleStatusTab } from "./_help/ModuleStatusTab";
import { ArticlesTab } from "./_help/ArticlesTab";
import { SopsTab } from "./_help/SopsTab";
import { ChecklistsTab } from "./_help/ChecklistsTab";
import { LimitationsTab } from "./_help/LimitationsTab";
import { ReleaseNotesTab } from "./_help/ReleaseNotesTab";
import { OnboardingTab } from "./_help/OnboardingTab";
import { PlaybooksTab } from "./_help/PlaybooksTab";
import { SearchTab } from "./_help/SearchTab";

type Tab =
  | "overview"
  | "modules"
  | "articles"
  | "sops"
  | "checklists"
  | "limitations"
  | "releases"
  | "onboarding"
  | "playbooks";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "overview", label: "Overview", icon: "grid" },
  { value: "modules", label: "Module Status", icon: "shield" },
  { value: "articles", label: "Help Articles", icon: "bookOpen" },
  { value: "sops", label: "SOPs", icon: "clipboard" },
  { value: "checklists", label: "Checklists", icon: "check" },
  { value: "limitations", label: "Limitations", icon: "alert" },
  { value: "releases", label: "Release Notes", icon: "history" },
  { value: "onboarding", label: "Onboarding", icon: "rocket" },
  { value: "playbooks", label: "Playbooks", icon: "shieldAlert" },
];

const TITLE = "Help & SOP Center";
const SUBTITLE = "Documentation, SOPs, checklists, playbooks & module status — curated in code";

export default function SuperAdminHelpPage() {
  const { ready, gate } = usePlatformGuard(TITLE, SUBTITLE);

  const [tab, setTab] = useState<Tab>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const bump = () => setReloadKey((k) => k + 1);

  const selectTab = (t: Tab) => {
    setSearch("");
    setSearchDraft("");
    setTab(t);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchDraft.trim()) setSearch(searchDraft.trim());
  };

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
          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={submitSearch} className="relative">
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search all docs…"
                aria-label="Search all help content"
                className="w-52 !py-2 pr-9"
              />
              <button
                type="submit"
                aria-label="Search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint transition hover:text-brand-600"
              >
                <Icon name="search" className="h-4 w-4" />
              </button>
            </form>
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
            onClick={() => selectTab(t.value)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.value && !search ? "bg-brand-600 text-white" : "text-muted hover:bg-hover"
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {search ? (
        <SearchTab query={search} onJump={selectTab} onClear={() => selectTab(tab)} />
      ) : (
        <>
          {tab === "overview" && <OverviewTab reloadKey={reloadKey} onJump={selectTab} />}
          {tab === "modules" && <ModuleStatusTab reloadKey={reloadKey} />}
          {tab === "articles" && <ArticlesTab reloadKey={reloadKey} />}
          {tab === "sops" && <SopsTab reloadKey={reloadKey} />}
          {tab === "checklists" && <ChecklistsTab reloadKey={reloadKey} />}
          {tab === "limitations" && <LimitationsTab reloadKey={reloadKey} />}
          {tab === "releases" && <ReleaseNotesTab reloadKey={reloadKey} />}
          {tab === "onboarding" && <OnboardingTab reloadKey={reloadKey} />}
          {tab === "playbooks" && <PlaybooksTab reloadKey={reloadKey} />}
        </>
      )}
    </>
  );
}

export type HelpTab = Tab;
