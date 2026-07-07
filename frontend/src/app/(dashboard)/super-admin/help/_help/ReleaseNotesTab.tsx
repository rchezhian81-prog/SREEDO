"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, EmptyState, ErrorNote, Modal, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { HelpReleaseNotesResponse, ReleaseNote } from "@/types";
import { BulletList, DetailBlock, KeyVal } from "./primitives";
import { formatDate, refOrDash } from "./taxonomy";

export function ReleaseNotesTab({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<ReleaseNote[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ReleaseNote | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HelpReleaseNotesResponse>("/help/release-notes");
      setData(res.releaseNotes);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load release notes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <section className="space-y-4">
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !data ? (
        !error && <EmptyState message="No release notes available." />
      ) : data.length === 0 ? (
        <EmptyState message="No release notes recorded yet." />
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-5">
          {data.map((r) => (
            <li key={r.id} className="relative">
              <span className="absolute -left-[1.6rem] top-1.5 h-3 w-3 rounded-full border-2 border-brand-500 bg-surface" />
              <button
                onClick={() => setActive(r)}
                className="group block w-full rounded-2xl border border-line bg-surface p-5 text-left shadow-card transition hover:border-brand-500/40 hover:bg-hover"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="slate">{r.module}</Badge>
                  {r.prNumber !== null && <Badge tone="blue">PR #{r.prNumber}</Badge>}
                  {r.deployNumber !== null && <Badge tone="slate">Deploy {r.deployNumber}</Badge>}
                  <span className="text-xs text-faint">{formatDate(r.date)}</span>
                </div>
                <p className="font-semibold text-ink group-hover:text-brand-600">{r.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{r.summary}</p>
                <p className="mt-2 text-xs text-faint">{r.changes.length} changes</p>
              </button>
            </li>
          ))}
        </ol>
      )}

      <ReleaseModal note={active} onClose={() => setActive(null)} />
    </section>
  );
}

function ReleaseModal({ note, onClose }: { note: ReleaseNote | null; onClose: () => void }) {
  if (!note) return null;
  return (
    <Modal title={note.title} open={note !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="slate">{note.module}</Badge>
          <span className="text-xs text-faint">{formatDate(note.date)}</span>
        </div>

        <p className="text-muted">{note.summary}</p>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Changes</p>
          <BulletList items={note.changes} />
        </div>

        {note.migrationSummary && (
          <DetailBlock title="Migration summary" icon="database">
            {note.migrationSummary}
          </DetailBlock>
        )}
        {note.safetyNotes && (
          <DetailBlock title="Safety notes" icon="alert" tone="amber">
            {note.safetyNotes}
          </DetailBlock>
        )}
        {note.smokeResult && (
          <DetailBlock title="Smoke result" icon="check">
            {note.smokeResult}
          </DetailBlock>
        )}
        {note.knownLimitations && (
          <DetailBlock title="Known limitations" icon="alert" tone="amber">
            {note.knownLimitations}
          </DetailBlock>
        )}
        {note.rollbackNote && (
          <DetailBlock title="Rollback note" icon="history" tone="red">
            {note.rollbackNote}
          </DetailBlock>
        )}

        <div className="rounded-xl border border-line px-4">
          <KeyVal label="PR">{note.prNumber !== null ? `#${note.prNumber}` : "—"}</KeyVal>
          <KeyVal label="Commit">
            <span className="font-mono text-xs">{note.commit ? note.commit.slice(0, 12) : "—"}</span>
          </KeyVal>
          <KeyVal label="Deploy">{refOrDash(note.deployNumber)}</KeyVal>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-faint">
          <Icon name="shield" className="h-3.5 w-3.5" />
          PR / commit / deploy references are the real confirmed value or “—” — never fabricated.
        </div>
      </div>
    </Modal>
  );
}
