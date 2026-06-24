"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

interface Option {
  id: string;
  label: string;
  votes?: number;
}
interface PollView {
  id: string;
  question: string;
  description: string | null;
  className: string | null;
  voted: boolean;
  closed: boolean;
  myOptionId: string | null;
  options: Option[];
}

export default function PortalPollPage() {
  const params = useParams<{ id: string }>();
  const pollId = params.id;
  const studentId = usePortalStore((state) => state.selectedStudentId);

  const [poll, setPoll] = useState<PollView | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      setPoll(await portalApi.get<PollView>(`/portal/students/${studentId}/polls/${pollId}`));
    } catch {
      setError("Could not load this poll.");
    } finally {
      setLoading(false);
    }
  }, [studentId, pollId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!studentId || !choice) return;
    setSubmitting(true);
    setError(null);
    try {
      await portalApi.post(`/portal/students/${studentId}/polls/${pollId}/vote`, { optionId: choice });
      await load();
    } catch {
      setError("Could not record your vote. The poll may be closed or already answered.");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (!poll) return <ErrorNote message={error ?? "Poll not found"} />;

  const showResults = poll.voted || poll.closed;
  const total = poll.options.reduce((sum, o) => sum + (o.votes ?? 0), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2">
        <Link href="/portal/polls" className="text-sm text-brand-600 hover:underline">
          ← Back to polls
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">{poll.question}</h1>
      <p className="mb-4 text-sm text-slate-500">{poll.className ?? "School-wide"}</p>

      <ErrorNote message={error} />

      {showResults ? (
        <div className="space-y-3">
          {poll.options.map((o) => {
            const pct = total > 0 ? Math.round(((o.votes ?? 0) / total) * 100) : 0;
            const mine = poll.myOptionId === o.id;
            return (
              <Card key={o.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className={mine ? "font-semibold text-brand-700" : "text-slate-800"}>
                    {o.label} {mine ? "(your vote)" : ""}
                  </span>
                  <span className="text-slate-500">
                    {o.votes ?? 0} · {pct}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
              </Card>
            );
          })}
          {poll.closed && !poll.voted ? (
            <p className="text-sm text-slate-500">This poll is closed.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {poll.options.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                choice === o.id ? "border-brand-400 bg-brand-50" : "border-slate-200"
              }`}
            >
              <input
                type="radio"
                name="poll"
                value={o.id}
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
              />
              <span>{o.label}</span>
            </label>
          ))}
          <div className="pt-2">
            <Button onClick={submit} disabled={!choice || submitting}>
              {submitting ? "Submitting…" : "Submit vote"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
