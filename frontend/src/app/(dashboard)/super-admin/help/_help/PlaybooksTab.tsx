"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Modal, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpPlaybooksResponse, Playbook } from "@/types";
import { BulletList, DetailBlock, KeyVal, StepList } from "./primitives";
import { formatDate, severityTone, titleCase } from "./taxonomy";

export function PlaybooksTab({ reloadKey }: { reloadKey: number }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Playbook[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Playbook | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpPlaybooksResponse>(`/help/playbooks?${query}`);
      setData(res.playbooks);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load playbooks");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-4">
      <Card>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emergency playbooks…"
          aria-label="Search playbooks"
        />
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No playbooks available." />
      ) : data.length === 0 ? (
        <EmptyState message="No playbooks match your search." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => (
            <button
              key={p.id}
              onClick={() => setActive(p)}
              className="group flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Icon name="shieldAlert" className="h-4 w-4 text-red-600" />
                <Badge tone={severityTone(p.severity)}>{titleCase(p.severity)}</Badge>
                {p.relatedModules.slice(0, 2).map((m) => (
                  <Badge key={m} tone="slate">
                    {m}
                  </Badge>
                ))}
              </div>
              <p className="font-semibold text-ink group-hover:text-brand-600">{p.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                {p.symptoms[0] ?? "Emergency response playbook."}
              </p>
              <p className="mt-3 text-xs text-faint">
                {p.safeSteps.length} safe steps · {p.recoveryChecklist.length} recovery items
              </p>
            </button>
          ))}
        </div>
      )}

      <PlaybookModal playbook={active} onClose={() => setActive(null)} />
    </section>
  );
}

function PlaybookModal({ playbook, onClose }: { playbook: Playbook | null; onClose: () => void }) {
  const [recovered, setRecovered] = useState<Set<number>>(new Set());

  useEffect(() => {
    setRecovered(new Set());
  }, [playbook?.id]);

  if (!playbook) return null;

  const toggle = (i: number) =>
    setRecovered((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Modal title={playbook.title} open={playbook !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Badge tone={severityTone(playbook.severity)}>{titleCase(playbook.severity)} severity</Badge>

        <DetailBlock title="Symptoms" icon="alert">
          <BulletList items={playbook.symptoms} />
        </DetailBlock>

        <DetailBlock title="First checks" icon="check">
          <StepList steps={playbook.firstChecks} />
        </DetailBlock>

        <DetailBlock title="What NOT to do" icon="alert" tone="red">
          <BulletList items={playbook.whatNotToDo} />
        </DetailBlock>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Safe steps</p>
          <StepList steps={playbook.safeSteps} />
        </div>

        <DetailBlock title="Escalation path" icon="rocket">
          {playbook.escalationPath}
        </DetailBlock>

        {playbook.relatedModules.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Related modules
            </p>
            <div className="flex flex-wrap gap-2">
              {playbook.relatedModules.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted"
                >
                  <Icon name="grid" className="h-3.5 w-3.5 text-faint" />
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        <DetailBlock title="Audit & security notes" icon="shield" tone="amber">
          {playbook.auditSecurityNotes}
        </DetailBlock>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Recovery checklist ({recovered.size}/{playbook.recoveryChecklist.length})
          </p>
          <ul className="space-y-1.5">
            {playbook.recoveryChecklist.map((item, i) => {
              const checked = recovered.has(i);
              return (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(i)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
                      aria-label={`Mark recovery step ${i + 1} done`}
                    />
                    <span className={checked ? "text-muted line-through" : "text-ink"}>{item}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-line px-4">
          <KeyVal label="Version">v{playbook.meta.version}</KeyVal>
          <KeyVal label="Last updated">{formatDate(playbook.meta.lastUpdated)}</KeyVal>
        </div>
      </div>
    </Modal>
  );
}
