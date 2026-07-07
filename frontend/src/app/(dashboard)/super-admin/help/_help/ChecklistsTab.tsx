"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Modal, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { Checklist, HelpChecklistsResponse } from "@/types";
import { ExportButtons, KeyVal } from "./primitives";
import { formatDate } from "./taxonomy";

export function ChecklistsTab({ reloadKey }: { reloadKey: number }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Checklist[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Checklist | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpChecklistsResponse>(`/help/checklists?${query}`);
      setData(res.checklists);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load checklists");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search checklists…"
          aria-label="Search checklists"
          className="max-w-sm"
        />
        <ExportButtons kind="checklists" filenameBase="help-checklists-snapshot" />
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No checklists available." />
      ) : data.length === 0 ? (
        <EmptyState message="No checklists match your search." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((c) => {
            const risky = c.items.filter((i) => i.productionRisk).length;
            return (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className="group flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Icon name="check" className="h-4 w-4 text-brand-600" />
                  <Badge tone="slate">{c.module}</Badge>
                  {risky > 0 && <Badge tone="red">{risky} production-risk</Badge>}
                </div>
                <p className="font-semibold text-ink group-hover:text-brand-600">{c.title}</p>
                {c.warning && <p className="mt-1 line-clamp-2 text-sm text-amber-600">{c.warning}</p>}
                <p className="mt-3 text-xs text-faint">
                  {c.items.length} checks · {formatDate(c.meta.lastUpdated)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <ChecklistModal checklist={active} onClose={() => setActive(null)} />
    </section>
  );
}

function toPlainText(c: Checklist): string {
  const lines: string[] = [`# ${c.title} (${c.module})`];
  if (c.route) lines.push(`Route: ${c.route}`);
  if (c.warning) lines.push(`WARNING: ${c.warning}`);
  lines.push("");
  c.items.forEach((it, i) => {
    const flags = [
      it.productionRisk ? "PRODUCTION RISK" : null,
      it.doNotTestOnRealData ? "DO NOT TEST ON REAL DATA" : null,
    ].filter(Boolean);
    lines.push(`[ ] ${i + 1}. ${it.text}`);
    lines.push(`      Expected: ${it.expectedResult}`);
    if (flags.length) lines.push(`      [!] ${flags.join(" | ")}`);
  });
  return lines.join("\n");
}

function ChecklistModal({ checklist, onClose }: { checklist: Checklist | null; onClose: () => void }) {
  const [done, setDone] = useState<Set<number>>(new Set());

  // Reset the local (unpersisted) tick state whenever a different checklist opens.
  useEffect(() => {
    setDone(new Set());
  }, [checklist?.id]);

  if (!checklist) return null;

  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(checklist));
      toast.success("Checklist copied to clipboard.");
    } catch {
      toast.error("Clipboard is not available in this browser.");
    }
  };

  return (
    <Modal title={checklist.title} open={checklist !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">{checklist.module}</Badge>
            <Badge tone="slate">
              {done.size}/{checklist.items.length} done
            </Badge>
          </div>
          <Button variant="secondary" onClick={copy} className="!px-3 !py-1.5">
            <Icon name="clipboard" className="h-4 w-4" />
            Copy checklist
          </Button>
        </div>

        {checklist.route && (
          <p className="text-xs text-faint">
            Route: <span className="font-mono">{checklist.route}</span>
          </p>
        )}

        {checklist.warning && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
            {checklist.warning}
          </div>
        )}

        <ul className="space-y-2">
          {checklist.items.map((it, i) => {
            const checked = done.has(i);
            return (
              <li
                key={i}
                className={`rounded-xl border p-3 transition ${
                  checked ? "border-emerald-500/30 bg-emerald-500/5" : "border-line bg-surface-2"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(i)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
                    aria-label={`Mark step ${i + 1} done`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${checked ? "text-muted line-through" : "text-ink"}`}>
                      {i + 1}. {it.text}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="font-semibold text-faint">Expected: </span>
                      {it.expectedResult}
                    </p>
                    {(it.productionRisk || it.doNotTestOnRealData) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {it.productionRisk && <Badge tone="red">Production risk</Badge>}
                        {it.doNotTestOnRealData && (
                          <Badge tone="amber">Do not test on real data</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="rounded-xl border border-line px-4">
          <KeyVal label="Version">v{checklist.meta.version}</KeyVal>
          <KeyVal label="Last updated">{formatDate(checklist.meta.lastUpdated)}</KeyVal>
        </div>

        <p className="text-xs text-faint">Tick state is local only — it is never saved.</p>
      </div>
    </Modal>
  );
}
