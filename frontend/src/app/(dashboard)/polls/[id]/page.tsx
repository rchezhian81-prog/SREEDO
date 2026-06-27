"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, PageHeader, Spinner } from "@/components/ui";

interface Option {
  id: string;
  label: string;
  votes: number;
}
interface Poll {
  id: string;
  question: string;
  description: string | null;
  className: string | null;
  isPublished: boolean;
  totalVotes: number;
  options: Option[];
}

export default function PollResultsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPoll(await api.get<Poll>(`/polls/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load poll");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePublish = async () => {
    if (!poll) return;
    try {
      await api.patch(`/polls/${id}`, { isPublished: !poll.isPublished });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  if (loading) return <Spinner />;
  if (!poll) return <ErrorNote message={error ?? "Poll not found"} />;

  const total = poll.totalVotes || 0;

  return (
    <>
      <div className="mb-2">
        <Link href="/polls" className="text-sm text-brand-600 hover:underline">
          ← Back to polls
        </Link>
      </div>
      <PageHeader
        title={poll.question}
        subtitle={`${poll.className ?? "School-wide"} · ${total} vote${total === 1 ? "" : "s"}`}
        action={
          <Button variant={poll.isPublished ? "secondary" : "primary"} onClick={togglePublish}>
            {poll.isPublished ? "Unpublish" : "Publish"}
          </Button>
        }
      />

      <ErrorNote message={error} />

      <div className="space-y-3">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          return (
            <div key={o.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-ink">{o.label}</span>
                <span className="text-muted">
                  {o.votes} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
