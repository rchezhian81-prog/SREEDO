"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { AiDocSearch } from "@/types";

export default function DocumentSearchPage() {
  const { can, loading: permsLoading } = usePermissions();
  const allowed = can("ai:document_search");

  const [query, setQuery] = useState("");
  const [data, setData] = useState<AiDocSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get<AiDocSearch>(
          `/ai-insights/search?q=${encodeURIComponent(q)}`
        )
      );
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Document search" />
        <Spinner />
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title="Document search" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Document search"
        subtitle="Find documents by name, category & owner"
      />

      <div className="mb-4">
        <Link
          href="/ai-insights"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to AI Insights
        </Link>
      </div>

      <div className="space-y-6">
        <Card>
          <div className="flex gap-2">
            <Input
              placeholder="Search documents…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
            />
            <Button onClick={search} disabled={loading || !query.trim()}>
              {loading ? "Searching…" : "Search"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Semantic ranking activates when embeddings are configured on the
            server; otherwise keyword search is used.
          </p>
        </Card>

        <ErrorNote message={error} />

        {loading ? (
          <Spinner />
        ) : data ? (
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-slate-500">Mode</span>
              <Badge tone={data.mode === "semantic" ? "blue" : "slate"}>
                {data.mode === "semantic" ? "Semantic" : "Keyword"}
              </Badge>
            </div>

            {data.results.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.results.map((result) => (
                  <li
                    key={result.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {result.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {result.category} · {result.ownerType}
                      </p>
                    </div>
                    {result.score != null && (
                      <span className="shrink-0 text-xs text-slate-400">
                        {result.score.toFixed(2)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="No matching documents." />
            )}
          </Card>
        ) : (
          <EmptyState message="Enter a query to search documents." />
        )}
      </div>
    </>
  );
}
