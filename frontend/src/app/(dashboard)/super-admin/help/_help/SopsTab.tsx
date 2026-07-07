"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorNote, Input, Modal, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpSopsResponse, Sop } from "@/types";
import { BulletList, DetailBlock, KeyVal, LinkList, StepList } from "./primitives";
import { formatDate } from "./taxonomy";

export function SopsTab({ reloadKey }: { reloadKey: number }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Sop[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Sop | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpSopsResponse>(`/help/sops?${query}`);
      setData(res.sops);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load SOPs");
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
          placeholder="Search SOPs by title or content…"
          aria-label="Search SOPs"
        />
      </Card>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No SOPs available." />
      ) : data.length === 0 ? (
        <EmptyState message="No SOPs match your search." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s)}
              className="group flex flex-col rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Icon name="clipboard" className="h-4 w-4 text-brand-600" />
                <Badge tone="slate">{s.requiredRole}</Badge>
                {s.approvalRequired && <Badge tone="amber">Approval required</Badge>}
                {s.safetyWarnings.length > 0 && <Badge tone="red">{s.safetyWarnings.length} warnings</Badge>}
              </div>
              <p className="font-semibold text-ink group-hover:text-brand-600">{s.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{s.purpose}</p>
              <p className="mt-3 text-xs text-faint">
                {s.steps.length} steps · v{s.meta.version} · {formatDate(s.meta.lastUpdated)}
              </p>
            </button>
          ))}
        </div>
      )}

      <SopModal sop={active} onClose={() => setActive(null)} />
    </section>
  );
}

function SopModal({ sop, onClose }: { sop: Sop | null; onClose: () => void }) {
  if (!sop) return null;
  return (
    <Modal title={sop.title} open={sop !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="slate">Role: {sop.requiredRole}</Badge>
          {sop.approvalRequired && <Badge tone="amber">Approval required</Badge>}
        </div>

        <DetailBlock title="Purpose" icon="bookOpen">
          {sop.purpose}
        </DetailBlock>
        <DetailBlock title="When to use" icon="help">
          {sop.whenToUse}
        </DetailBlock>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Steps</p>
          <StepList steps={sop.steps} />
        </div>

        {sop.safetyWarnings.length > 0 && (
          <DetailBlock title="Safety warnings" icon="alert" tone="amber">
            <BulletList items={sop.safetyWarnings} />
          </DetailBlock>
        )}

        {sop.approvalRequired && (
          <DetailBlock title="Approval required" icon="shieldCheck" tone="amber">
            {sop.approvalRequired}
          </DetailBlock>
        )}

        <DetailBlock title="Audit expectation" icon="history">
          {sop.auditExpectation}
        </DetailBlock>
        <DetailBlock title="Smoke-test check" icon="check">
          {sop.smokeTestCheck}
        </DetailBlock>

        {sop.relatedLinks.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Related</p>
            <LinkList links={sop.relatedLinks} />
          </div>
        )}

        <div className="rounded-xl border border-line px-4">
          <KeyVal label="Version">v{sop.meta.version}</KeyVal>
          <KeyVal label="Last updated">
            {formatDate(sop.meta.lastUpdated)} · {sop.meta.lastUpdatedBy}
          </KeyVal>
          {sop.meta.reviewedBy && <KeyVal label="Reviewed by">{sop.meta.reviewedBy}</KeyVal>}
        </div>
      </div>
    </Modal>
  );
}
