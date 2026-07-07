"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpDocType, HelpSearchResponse, HelpSearchResult } from "@/types";
import type { HelpTab } from "../page";
import { contentTypeMeta } from "./taxonomy";

const TYPE_TO_TAB: Record<HelpDocType, HelpTab> = {
  help: "articles",
  sop: "sops",
  checklist: "checklists",
  playbook: "playbooks",
  release: "releases",
  limitation: "limitations",
};

const TYPE_OPTIONS: HelpDocType[] = [
  "help",
  "sop",
  "checklist",
  "playbook",
  "release",
  "limitation",
];

export function SearchTab({
  query,
  onJump,
  onClear,
}: {
  query: string;
  onJump: (tab: HelpTab) => void;
  onClear: () => void;
}) {
  const [type, setType] = useState("");
  const [data, setData] = useState<HelpSearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (type) p.set("type", type);
    return p.toString();
  }, [query, type]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpSearchResponse>(`/help/search?${qs}`);
      setData(res.results);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="search" className="h-4 w-4 shrink-0 text-faint" />
          <p className="min-w-0 truncate text-sm text-muted">
            Results for <span className="font-semibold text-ink">“{query}”</span>
            {data && <span className="text-faint"> · {data.length} hits</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by content type"
            className="!py-2"
          >
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {contentTypeMeta(t).label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={onClear} className="!px-3 !py-2">
            <Icon name="x" className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No search results available." />
      ) : data.length === 0 ? (
        <EmptyState message={`Nothing matched “${query}”. Try a different term or clear the type filter.`} />
      ) : (
        <ul className="space-y-2">
          {data.map((r) => {
            const meta = contentTypeMeta(r.type);
            return (
              <li key={`${r.type}-${r.id}`}>
                <button
                  onClick={() => onJump(TYPE_TO_TAB[r.type])}
                  className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
                >
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                    <Icon name={meta.icon} className="h-4 w-4 text-brand-600" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink group-hover:text-brand-600">{r.title}</span>
                      <Badge tone="slate">{meta.label}</Badge>
                      {r.module && <span className="text-xs text-faint">· {r.module}</span>}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-sm text-muted">{r.snippet}</span>
                  </span>
                  <Icon
                    name="arrowRight"
                    className="mt-1 h-4 w-4 shrink-0 text-faint transition group-hover:text-brand-600"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
