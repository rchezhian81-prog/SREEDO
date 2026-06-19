"use client";

import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { Thread, ThreadDetail } from "@/types";

function relativeTime(value: string | null): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(value).toLocaleDateString();
}

function threadTitle(subject: string | null, fallback: string): string {
  if (subject && subject.trim()) return subject;
  if (fallback && fallback.trim()) return fallback;
  return "Conversation";
}

export default function PortalMessagesPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setThreads(await portalApi.get<Thread[]>("/communication/threads"));
    } catch {
      setError("Could not load your messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openThread = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setSendError(null);
    setBody("");
    setDetailLoading(true);
    try {
      const data = await portalApi.get<ThreadDetail>(
        "/communication/threads/" + id
      );
      setDetail(data);
      try {
        await portalApi.post("/communication/threads/" + id + "/read");
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === id ? { ...thread, unreadCount: 0 } : thread
          )
        );
      } catch {
        // Non-fatal: the unread badge simply lingers until next load.
      }
    } catch {
      setDetailError("Could not load this conversation.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const reply = async () => {
    if (!selectedId || !body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await portalApi.post(
        "/communication/threads/" + selectedId + "/messages",
        { body: body.trim() }
      );
      const refreshed = await portalApi.get<ThreadDetail>(
        "/communication/threads/" + selectedId
      );
      setDetail(refreshed);
      setBody("");
      await load();
    } catch {
      setSendError("Could not send your reply.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Messages" subtitle="Conversations with the school" />
        <Spinner />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Messages" subtitle="Conversations with the school" />
      <ErrorNote message={error} />

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-2">
          {threads.length === 0 ? (
            <EmptyState message="You have no messages." />
          ) : (
            threads.map((thread) => {
              const active = thread.id === selectedId;
              const unread = thread.unreadCount > 0;
              return (
                <button
                  key={thread.id}
                  onClick={() => openThread(thread.id)}
                  className={cx(
                    "w-full rounded-xl border p-4 text-left transition",
                    active
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 bg-white hover:border-brand-200"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cx(
                        "truncate text-sm",
                        unread
                          ? "font-semibold text-slate-900"
                          : "font-medium text-slate-800"
                      )}
                    >
                      {threadTitle(thread.subject, thread.participants)}
                    </span>
                    {unread && <Badge tone="green">{thread.unreadCount}</Badge>}
                  </div>
                  {thread.lastMessage && (
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {thread.lastMessage}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {relativeTime(thread.lastMessageAt ?? thread.createdAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>

        <div className="min-w-0">
          {!selectedId ? (
            <EmptyState message="Select a conversation to read it." />
          ) : detailLoading ? (
            <Spinner />
          ) : detailError ? (
            <ErrorNote message={detailError} />
          ) : !detail ? (
            <EmptyState message="Conversation not found." />
          ) : (
            <Card className="flex h-full flex-col">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="truncate text-lg font-semibold text-slate-900">
                  {threadTitle(
                    detail.subject,
                    detail.participants.map((p) => p.name).join(", ")
                  )}
                </h2>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {detail.participants.map((p) => p.name).join(", ")}
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto py-4">
                {detail.messages.length === 0 ? (
                  <EmptyState message="No messages yet." />
                ) : (
                  detail.messages.map((message) => (
                    <div
                      key={message.id}
                      className="rounded-lg bg-slate-50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">
                          {message.senderName ?? "School"}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(message.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        {message.body}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-200 pt-3">
                <Textarea
                  rows={3}
                  placeholder="Write a reply…"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <div className="mt-2">
                  <ErrorNote message={sendError} />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button onClick={reply} disabled={sending || !body.trim()}>
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
