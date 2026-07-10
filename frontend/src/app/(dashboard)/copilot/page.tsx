"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms } from "@/lib/terms";
import { Icon } from "@/components/icons";
import { Badge, Button, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";

// PR-T11 — AI Copilot Phase 1 (read-only). The copilot answers from
// permissioned, tenant-scoped reads and CITES its sources; it can draft text
// but never sends, creates, updates or deletes anything. The surface is
// off-by-default (per-tenant aiCopilot flag) + ai:copilot permission + provider.

interface Source { type: "metric" | "doc" | "link"; id: string; label: string; href?: string }
interface Turn { role: "user" | "assistant"; content: string; sources?: Source[] }
interface AskResponse {
  reply: string; sources: Source[]; retrieversUsed: string[];
  aiAvailable: boolean; conversationId: string | null;
}

const TONE: Record<Source["type"], "blue" | "green" | "slate"> = {
  metric: "blue", doc: "green", link: "slate",
};

const STARTERS = [
  "What needs attention today?",
  "Summarize attendance issues",
  "How much fee is outstanding?",
  "How do I run the year rollover?",
  "Draft a message to parents about the PTM",
];

export default function CopilotPage() {
  const { can, loading: permLoading } = usePermissions();
  const canUse = can("ai:copilot");
  const term = useTerms();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabledMsg, setDisabledMsg] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const conversationId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true); setError(null); setInput("");
    setTurns((t) => [...t, { role: "user", content: message }]);
    try {
      const r = await api.post<AskResponse>("/ai/copilot", {
        message,
        ...(conversationId.current ? { conversationId: conversationId.current } : {}),
      });
      conversationId.current = r.conversationId;
      setDegraded(!r.aiAvailable);
      setTurns((t) => [...t, { role: "assistant", content: r.reply, sources: r.sources }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Feature flag off for this institution (or permission revoked mid-session).
        setDisabledMsg(e.message);
      } else if (e instanceof ApiError && e.status === 503) {
        setError("The AI provider is not configured. Ask your administrator to set it up — the AI Insights dashboards still work without it.");
      } else if (e instanceof ApiError && e.status === 429) {
        setError(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "The copilot could not answer");
      }
      setTurns((t) => t.slice(0, -1)); // roll back the unanswered user turn
    } finally {
      setBusy(false);
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  if (permLoading) return <Spinner />;
  if (!canUse) {
    return (
      <>
        <PageHeader title="AI Copilot" subtitle="Read-only assistant for your daily operations" />
        <EmptyState message="You don't have access to the AI Copilot." />
      </>
    );
  }
  if (disabledMsg) {
    return (
      <>
        <PageHeader title="AI Copilot" subtitle="Read-only assistant for your daily operations" />
        <EmptyState message="The AI Copilot is not enabled for this institution yet. It is off by default and can be switched on per institution." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="AI Copilot"
        subtitle={`Ask about attendance, fees, exams, ${term.students.toLowerCase()}, leave, jobs or how-to procedures — answers cite their sources and nothing is ever changed or sent`}
      />
      {degraded && (
        <div className="mb-3 rounded-lg border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-sm text-muted">
          AI phrasing is temporarily unavailable — showing the retrieved facts directly.
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        {turns.length === 0 ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/12">
              <Icon name="sparkles" className="h-6 w-6 text-brand-600 dark:text-brand-300" />
            </div>
            <p className="mb-1 text-sm font-medium text-ink">Read-only by design</p>
            <p className="mx-auto mb-4 max-w-md text-sm text-muted">
              The copilot reads only what your role can already see, cites every claim, and
              points you to the manual screen for any action. Try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => ask(s)} disabled={busy}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink hover:border-brand-500">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  t.role === "user" ? "bg-brand-600 text-white" : "border border-line bg-surface-2 text-ink"
                }`}>
                  <div className="whitespace-pre-wrap">{t.content}</div>
                  {t.role === "assistant" && (t.sources?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                      {t.sources!.map((s, j) =>
                        s.href ? (
                          <Link key={j} href={s.href}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted hover:border-brand-500 hover:text-ink">
                            <Badge tone={TONE[s.type]}>{s.type}</Badge> {s.label}
                          </Link>
                        ) : (
                          <span key={j} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                            <Badge tone={TONE[s.type]}>{s.type}</Badge> {s.label}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <Spinner />}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question — the copilot only reads, never acts…"
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-brand-500"
          maxLength={2000}
        />
        <Button type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "Ask"}</Button>
      </form>
      <ErrorNote message={error} />
      <p className="mt-3 text-xs text-faint">
        Every question is audited. Drafts are text only — review and send them yourself from the
        Communication screen.
      </p>
    </>
  );
}
