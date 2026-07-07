"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpOnboardingResponse, OnboardingSection } from "@/types";
import { RichText, StepList } from "./primitives";

export function OnboardingTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<OnboardingSection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpOnboardingResponse>("/help/onboarding");
      setData([...res.sections].sort((a, b) => a.order - b.order));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load onboarding guide");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // Open the first section by default once loaded.
  const firstId = useMemo(() => data?.[0]?.id ?? null, [data]);
  useEffect(() => {
    setOpen(firstId);
  }, [firstId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return <EmptyState message="No onboarding guide available." />;
  if (data.length === 0) return <EmptyState message="The onboarding guide has no sections yet." />;

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">
        {data.length} onboarding sections for the platform super administrator.
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {data.map((s) => {
          const expanded = open === s.id;
          return (
            <div key={s.id} className="border-b border-line last:border-0">
              <button
                onClick={() => setOpen(expanded ? null : s.id)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-hover"
                aria-expanded={expanded}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-sm font-bold text-brand-600">
                  {s.order}
                </span>
                <span className="min-w-0 flex-1 font-semibold text-ink">{s.title}</span>
                <Icon
                  name="chevronDown"
                  className={`h-4 w-4 shrink-0 text-faint transition ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-line bg-surface-2 px-5 py-4">
                  <RichText text={s.body} />
                  {s.steps.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        Steps
                      </p>
                      <StepList steps={s.steps} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
